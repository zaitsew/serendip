import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { gate } from "../auth";
import { fail } from "../http";
import { createMcpServer } from "./server";
import { TOOLS } from "./tools";

/**
 * The HTTP side of /mcp (bearer header) and /mcp/<key> (key in the path, for connectors that cannot set
 * a header). Both go through the one `gate()`, so the lockout counts a wrong path key exactly like a wrong
 * bearer key and a locked-out client is refused before any key is compared. The path is a secret: it is
 * never logged, the request handed to the SDK carries a clean URL, and error text passes through `redact`.
 */

const MAX_BODY_BYTES = 1_000_000;

/** Removes the key (raw and URL-encoded) from text that is about to be logged or returned. */
export function redact(text: string, key: string | null | undefined): string {
  if (!key) return text;
  let out = text.split(key).join("[redacted]");
  const enc = encodeURIComponent(key);
  if (enc !== key) out = out.split(enc).join("[redacted]");
  return out;
}

/** Reads at most `limit` bytes of the body; null when it is larger, without buffering the rest. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}

/** The raw URL segment (still percent-encoded), decoded once; "invalid" when it cannot be decoded, so it counts as a wrong guess. */
function keyFromPath(segment: string): string {
  try {
    return decodeURIComponent(segment).trim().slice(0, 512) || "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Headers for `gate()` when the key came in the path: the key as a bearer, the client address, and no
 * cookie. Without that last rule a signed-in browser would pass with any key in the URL.
 */
function pathHeaders(request: Request, key: string): Headers {
  const h = new Headers();
  h.set("authorization", `Bearer ${key}`);
  for (const name of ["x-forwarded-for", "host"]) {
    const v = request.headers.get(name);
    if (v) h.set(name, v);
  }
  return h;
}

function denied(res: ReturnType<typeof gate>): Response | null {
  if (res.ok) return null;
  return "locked" in res ? res.locked : fail(res.status, res.error);
}

export async function handleMcp(request: Request, opts: { pathKey?: string } = {}): Promise<Response> {
  const key = opts.pathKey === undefined ? null : keyFromPath(opts.pathKey);
  const refused = denied(gate(key === null ? request.headers : pathHeaders(request, key)));
  if (refused) return refused;

  if (request.method === "GET" || request.method === "DELETE") {
    return Response.json(
      { name: "serendip", transport: "Streamable HTTP, stateless: POST JSON-RPC to this URL with Accept: application/json, text/event-stream", tools: TOOLS.map((t) => t.name) },
      { status: 405, headers: { Allow: "POST", "cache-control": "no-store" } },
    );
  }
  if (request.method !== "POST") return fail(405, "Use POST.");

  try {
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "Body too large.");
    const body = await readCapped(request, MAX_BODY_BYTES);
    if (body === null) return fail(413, "Body too large.");
    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    const clean = new Request("http://serendip.invalid/mcp", { method: "POST", headers, body });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer();
    await server.connect(transport);
    try {
      return await transport.handleRequest(clean);
    } finally {
      void server.close().catch(() => undefined);
    }
  } catch (err) {
    console.error("[mcp] request failed:", redact(err instanceof Error ? err.message : "unknown error", key));
    return fail(500, "Something went wrong on the server.");
  }
}
