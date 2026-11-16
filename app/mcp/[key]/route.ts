import { handleMcp } from "../../../src/server/mcp/http";

/**
 * POST /mcp/<owner key>: the same server for connectors that cannot send a header. The URL is the secret:
 * it goes through the same lockout as a bearer key, and nothing here logs the path.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The key is read from the raw request path and decoded exactly once in handleMcp. Route params are
// already decoded by Next, so decoding them again would turn an encoded "%2F" in a key into "/".
const handle = async (request: Request) => handleMcp(request, { pathKey: rawLastSegment(request.url) });

function rawLastSegment(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
