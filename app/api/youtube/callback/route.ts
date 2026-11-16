import { requireOwner } from "../../../../src/server/auth";
import { depsFromEnv, finishConnect, syncToYoutube } from "../../../../src/server/detour";
import { siteUrl } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const back = (request: Request, query: string) => new Response(null, { status: 302, headers: { location: siteUrl(request, `/detour?${query}`), "cache-control": "no-store" } });

/** Google sends the browser here with `code` and `state`. The state must match the one we issued, once. */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const s = store();
  const deps = depsFromEnv();
  const r = await finishConnect(s, deps, { state: q.get("state"), code: q.get("code"), error: q.get("error") });
  if (!r.ok) return back(request, `yt=error&reason=${encodeURIComponent(r.reason)}`);
  // Write today's picks to the new playlist straight away, if there are any.
  const picks = s.yt.getPicks()?.picks.map((p) => p.videoId) ?? [];
  if (picks.length) await syncToYoutube(s, deps, picks).catch(() => undefined);
  return back(request, "yt=connected");
}
