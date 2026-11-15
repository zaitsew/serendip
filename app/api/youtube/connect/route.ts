import { requireOwner } from "../../../../src/server/auth";
import { beginConnect, depsFromEnv } from "../../../../src/server/detour";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

const back = (request: Request, query: string) => new Response(null, { status: 302, headers: { location: new URL(`/detour?${query}`, request.url).toString(), "cache-control": "no-store" } });

/** Starts the OAuth flow. Google only accepts the localhost redirect, so this must be opened from the Mac's browser. */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (host !== "localhost" && host !== "127.0.0.1") return back(request, "yt=localhost");
  const url = beginConnect(store(), depsFromEnv());
  if (!url) return back(request, "yt=not_configured");
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}
