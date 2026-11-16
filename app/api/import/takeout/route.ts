import { requireOwner } from "../../../../src/server/auth";
import { analyzeHistory, depsFromEnv, importTakeout, type TakeoutReport } from "../../../../src/server/detour";
import { fail, json } from "../../../../src/server/http";
import { MAX_TAKEOUT_VIDEOS, TakeoutError } from "../../../../src/core/takeout";
import { store } from "../../../../src/server/store";
import { MAX_CHUNK_BYTES, validateTakeoutPayload } from "../../../../src/server/takeout-payload";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The small-file route (a curl one-liner): the whole file in a multipart form, read on the server. The
 * droplet container has a 128 MB heap, so this is capped well below what a Takeout export can be.
 * /setup does not use it: the browser parses the file and sends compact chunks (JSON body, below).
 */
const MAX_FULL_FILE_BYTES = 5 * 1024 * 1024;

async function fullFile(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Send watch-history.json as the `file` field.");
  if (file.size > MAX_FULL_FILE_BYTES) return fail(413, "Files over 5 MB must go through the /setup page, which reads the file in your browser.");
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

/** Chunks are staged; the commit swaps them in for the whole history in one transaction, then reads topics. */
async function compact(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_CHUNK_BYTES) return fail(413, "That chunk is larger than 2 MB.");
  const checked = validateTakeoutPayload(await request.text());
  if (!checked.ok) return fail(checked.status, checked.error);
  const p = checked.payload;
  const s = store();
  if (p.phase === "chunk") {
    if (s.yt.stagedCount(p.uploadId) + p.videos.length > MAX_TAKEOUT_VIDEOS) return fail(413, "That history has more videos than Serendip reads.");
    return json({ ok: true, ...s.yt.stageWatched(p.uploadId, p.videos) });
  }
  const done = s.yt.commitWatched(p.uploadId);
  if (!done) return fail(400, "Nothing was uploaded under that id. Choose the file again.");
  const deps = depsFromEnv();
  const analysis = deps.yt ? await analyzeHistory(s, deps).catch(() => null) : null;
  const report: TakeoutReport = { rows: p.rows, videos: done.videos, channels: done.channels, skipped: p.skipped, analysis };
  return json(report);
}

export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  return /^application\/json/i.test(request.headers.get("content-type") ?? "") ? compact(request) : fullFile(request);
}
