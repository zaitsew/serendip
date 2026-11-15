import { z } from "zod";
import { json, owned } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({ type: z.enum(["open", "pick_shown", "detour_shown", "detour_watch"]), filmId: z.number().int().optional(), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional(), variant: z.enum(["a", "b"]).optional(), device: z.enum(["tv", "touch", "desktop"]).optional() });

/** Counters only: no free text ever goes into an event. */
export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const meta: Record<string, string> = {};
  if (r.body.variant) meta.variant = r.body.variant;
  if (r.body.device) meta.device = r.body.device;
  if (r.body.videoId) meta.videoId = r.body.videoId; // a public video id, never free text
  store().event(r.body.type, r.body.filmId ?? null, Object.keys(meta).length ? meta : null);
  return json({ ok: true });
}
