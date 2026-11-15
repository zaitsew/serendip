import { catalog } from "../../../../src/catalog";
import { requireOwner } from "../../../../src/server/auth";
import { fail, json } from "../../../../src/server/http";
import { importNetflix } from "../../../../src/server/service";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Send ViewingActivity.csv as the `file` field.");
  if (file.size > 20 * 1024 * 1024) return fail(413, "That CSV is larger than 20 MB.");
  try {
    return json(await importNetflix(store(), catalog(), await file.text()));
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "Could not read that CSV.");
  }
}
