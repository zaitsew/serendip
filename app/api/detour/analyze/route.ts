import { requireOwner } from "../../../../src/server/auth";
import { analyzeHistory, depsFromEnv } from "../../../../src/server/detour";
import { fail, json } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Fetch topics for the watched videos that are not cached yet (at most 40 calls, 1 unit each). */
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const deps = depsFromEnv();
  if (!deps.yt) return fail(400, "Add YOUTUBE_API_KEY to read topics. Without it Serendip clusters by channel only.");
  return json(await analyzeHistory(store(), deps));
}
