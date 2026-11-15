import { z } from "zod";
import { catalog } from "../../../src/catalog";
import { fail, json, owned } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({ filmId: z.number().int(), action: z.enum(["save", "seen", "dismiss"]) });

export async function POST(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const film = await catalog().film(r.body.filmId);
  if (!film) return fail(404, "Film not found.");
  store().act(film, r.body.action);
  return json({ ok: true });
}
