import { requireOwner } from "../../../../src/server/auth";
import { beginConnect, depsFromEnv } from "../../../../src/server/detour";
import { isLocalRedirect } from "../../../../src/youtube/oauth";
import { siteUrl } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

const back = (request: Request, query: string) => new Response(null, { status: 302, headers: { location: siteUrl(request, `/detour?${query}`), "cache-control": "no-store" } });

/**
 * Starts the OAuth flow. With the localhost redirect (dev) this must be opened from the Mac's own browser, because
 * Google refuses a LAN address. With a public https redirect (SERENDIP_PUBLIC_URL) any browser on that address works.
 */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const deps = depsFromEnv();
  const host = (request.headers.get("host") ?? "").split(":")[0];
  if (deps.oauth && isLocalRedirect(deps.oauth.redirectUri) && host !== "localhost" && host !== "127.0.0.1") return back(request, "yt=localhost");
  const url = beginConnect(store(), deps);
  if (!url) return back(request, "yt=not_configured");
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}
