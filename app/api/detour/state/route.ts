import { requireOwner } from "../../../../src/server/auth";
import { depsFromEnv, detourState } from "../../../../src/server/detour";
import { json } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

/** Everything /setup and /detour show. Reading it costs no YouTube quota. */
export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  return json(detourState(store(), depsFromEnv()));
}
