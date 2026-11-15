import { z } from "zod";
import { json, owned } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({ type: z.enum(["open", "pick_shown"]), filmId: z.number().int().optional(), variant: z.enum(["a", "b"]).optional(), device: z.enum(["tv", "touch", "desktop"]).optional() });

/** Counters only: no free text ever goes into an event. */
export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const meta: Record<string, string> = {};
  if (r.body.variant) meta.variant = r.body.variant;
  if (r.body.device) meta.device = r.body.device;
  store().event(r.body.type, r.body.filmId ?? null, Object.keys(meta).length ? meta : null);
  return json({ ok: true });
}
