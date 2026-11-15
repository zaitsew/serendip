import { NextResponse, type NextRequest } from "next/server";
import { authenticate, throttleFailure } from "./src/server/auth";

/**
 * Pages need the owner's session. /api routes check the key themselves (they answer JSON, not a
 * redirect), /signin is how you get a session, and static assets are public.
 */
export function proxy(request: NextRequest) {
  const h = request.headers;
  const auth = authenticate({ cookie: h.get("cookie"), authorization: h.get("authorization") });
  if (auth.ok) return undefined;
  // Page requests count wrong bearer keys against the same per-client throttle as the API.
  const throttled = throttleFailure(h, auth.presented);
  if (throttled) return throttled;

  const { pathname, search } = request.nextUrl;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  const host = h.get("host") || request.nextUrl.host;
  const next = pathname === "/" && !search ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  const res = NextResponse.redirect(new URL(`/signin${next}`, `${proto}://${host}`));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: ["/((?!api(?:/|$)|signin(?:/|$)|_next/|icon\\.svg$|favicon\\.ico$|robots\\.txt$).*)"],
};
