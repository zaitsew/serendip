import { z } from "zod";
import { requireOwner } from "../../../src/server/auth";
import { fail, json, owned } from "../../../src/server/http";
import { isDay } from "../../../src/server/service";
import { EVENING_SOURCES, store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

/** GET ?yesterday=YYYY-MM-DD: should /tv ask about that evening? GET with no query lists the log. */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const s = store();
  const y = new URL(request.url).searchParams.get("yesterday");
  if (y !== null) {
    if (!isDay(y)) return fail(400, "yesterday must be YYYY-MM-DD.");
    return json({ ask: !s.hasEvening(y) && !s.dismissedPrompt(y) });
  }
  return json({ evenings: s.evenings() });
}

const Body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  watched: z.string().trim().min(1).max(200),
  source: z.enum(EVENING_SOURCES),
  enjoyment: z.number().int().min(1).max(5).nullable(),
  minutesToChoose: z.number().int().min(0).max(600).nullable(),
});

export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  store().logEvening(r.body);
  return json({ ok: true });
}

/** Dismiss the prompt for one evening. */
export async function DELETE(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const day = new URL(request.url).searchParams.get("day");
  if (!isDay(day)) return fail(400, "day must be YYYY-MM-DD.");
  store().dismissPrompt(day);
  return json({ ok: true });
}
