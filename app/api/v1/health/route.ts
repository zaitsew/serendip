import { json } from "../../../../src/server/http";
import { VERSION } from "../../../../src/server/version";

export const dynamic = "force-dynamic";

/** Unauthenticated liveness for the container healthcheck and the deploy script. Says nothing about the data or the config. */
export function GET() {
  return json({ ok: true, version: VERSION });
}
