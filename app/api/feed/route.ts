import { requireOwner } from "../../../src/server/auth";
import { buildFeedView } from "../../../src/server/feedview";
import { fail, json } from "../../../src/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    return json(await buildFeedView());
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Could not build the channels.");
  }
}
