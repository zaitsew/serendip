import { requireOwner } from "../../../../src/server/auth";
import { analyzeHistory, depsFromEnv, importTakeout } from "../../../../src/server/detour";
import { fail, json } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";
import { TakeoutError } from "../../../../src/core/takeout";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const MAX_TAKEOUT_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Send watch-history.json as the `file` field.");
  if (file.size > MAX_TAKEOUT_BYTES) return fail(413, "That file is larger than 50 MB.");
  try {
    const s = store();
    const report = importTakeout(s, await file.text());
    const deps = depsFromEnv();
    const analysis = deps.yt ? await analyzeHistory(s, deps) : null;
    return json({ ...report, analysis });
  } catch (e) {
    if (e instanceof TakeoutError) return fail(400, e.message);
    return fail(400, "Could not read that file.");
  }
}
