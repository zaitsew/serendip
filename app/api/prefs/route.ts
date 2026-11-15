import { z } from "zod";
import { owned, json } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  providers: z.array(z.number().int()).max(40),
  languages: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(30),
  subtitles: z.boolean(),
});

export async function PUT(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  store().setPrefs(r.body);
  return json({ ok: true });
}
