import { z } from "zod";
import { fail, json, owned } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), action: z.enum(["save", "seen", "dismiss"]) });

/** Save, Seen, or Not for me on a Detour pick. "Not for me" mutes the channel for 90 days and lowers the field. */
export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const s = store();
  const pick = s.yt.getPicks()?.picks.find((p) => p.videoId === r.body.videoId);
  if (!pick) return fail(404, "That video is not in today's Detour.");
  s.yt.detourAct({ videoId: pick.videoId, action: r.body.action, field: pick.field, channelId: pick.channelId, channelTitle: pick.channelTitle, title: pick.title });
  return json({ ok: true });
}
