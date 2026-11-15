import { requireOwner } from "../../../../src/server/auth";
import { depsFromEnv, refreshDetour } from "../../../../src/server/detour";
import { json } from "../../../../src/server/http";
import { store } from "../../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Build today's picks now. The daily search budget still applies, so pressing it twice is safe. */
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  return json(await refreshDetour(store(), depsFromEnv(), { force: true }));
}
