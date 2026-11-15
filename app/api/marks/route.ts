import { z } from "zod";
import { catalog } from "../../../src/catalog";
import { fail, json, owned } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const MAX_LOVED = 15;
const Body = z.object({ filmId: z.number().int(), role: z.enum(["seed", "dislike"]), remove: z.boolean().optional() });

/** Setup lists: up to 15 loved films and any number of disliked ones. */
export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const { filmId, role, remove } = r.body;
  const s = store();
  if (remove) {
    s.unmark(filmId, role);
    return json({ ok: true });
  }
  if (role === "seed" && !s.ids("seed").has(filmId) && s.marked("seed").filter((m) => m.source === "setup").length >= MAX_LOVED) return fail(400, `Up to ${MAX_LOVED} loved films.`);
  const film = await catalog().film(filmId);
  if (!film) return fail(404, "Film not found.");
  s.mark(film, role, "setup", role === "seed" ? 5 : null);
  return json({ ok: true });
}
