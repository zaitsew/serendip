import { cookies } from "next/headers";
import { authenticate, COOKIE_NAME, sessionCookieOptions, sessionValue, ownerKey } from "./auth";

/** For server components and actions. Pages accept the session cookie only. */
export async function isSignedIn(): Promise<boolean> {
  const cookie = (await cookies()).get(COOKIE_NAME);
  return authenticate({ cookie: cookie ? `${COOKIE_NAME}=${cookie.value}` : null, authorization: null }).ok;
}

export async function setSessionCookie(): Promise<void> {
  const key = ownerKey();
  if (!key) throw new Error("SERENDIP_OWNER_KEY is not set.");
  (await cookies()).set(COOKIE_NAME, sessionValue(key), sessionCookieOptions());
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}
