import { requireOwner } from "../../../../src/server/auth";
import { depsFromEnv, disconnect } from "../../../../src/server/detour";
import { json } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";

/** Revokes the token at Google and deletes it here. */
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  return json(await disconnect(store(), depsFromEnv()));
}
