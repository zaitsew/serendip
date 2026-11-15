import { catalog } from "../../../../src/catalog";
import { requireOwner } from "../../../../src/server/auth";
import { fail, json } from "../../../../src/server/http";
import { importLetterboxd } from "../../../../src/server/service";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Send the Letterboxd export ZIP as the `file` field.");
  if (file.size > 30 * 1024 * 1024) return fail(413, "That ZIP is larger than 30 MB.");
  try {
    return json(await importLetterboxd(store(), catalog(), Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Could not read that ZIP.");
  }
}
