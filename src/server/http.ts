import { z } from "zod";
import { requireOwner } from "./auth";

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export const fail = (status: number, error: string) => json({ error }, status);

/** Owner check, then JSON body validation. Returns the parsed body or the response to send. */
export async function owned<T extends z.ZodType>(request: Request, schema: T): Promise<{ ok: true; body: z.infer<T> } | { ok: false; response: Response }> {
  const denied = requireOwner(request);
  if (denied) return { ok: false, response: denied };
  let raw: unknown;
  try { raw = await request.json(); } catch { return { ok: false, response: fail(400, "Body must be JSON.") }; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: fail(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")) };
  return { ok: true, body: parsed.data };
}

/**
 * An absolute URL on this site for a redirect. Behind the droplet's proxy the container sees its own bind
 * address, not the host the browser used, so SERENDIP_PUBLIC_URL (when set) decides the origin.
 */
export function siteUrl(request: Request, path: string, env: Record<string, string | undefined> = process.env): string {
  const pub = env.SERENDIP_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return new URL(path, pub || request.url).toString();
}
