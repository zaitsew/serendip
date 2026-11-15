import { z } from "zod";
import { cleanFields } from "../../../../src/core/detour";
import { json, owned } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

const Body = z.object({ fields: z.array(z.string().max(120)).max(40) });

export async function PUT(request: Request) {
  const r = await owned(request, Body);
  if (!r.ok) return r.response;
  const fields = cleanFields(r.body.fields);
  store().yt.setFields(fields);
  return json({ fields });
}
