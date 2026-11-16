import { requireOwner } from "../../../../src/server/auth";
import { tonight } from "../../../../src/server/feedview";
import { fail, json } from "../../../../src/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** What is on tonight: every channel's current picks and today's Detour. Owner only (bearer key or session). */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    return json(await tonight());
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Could not build tonight's picks.");
  }
}
