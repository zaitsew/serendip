import { NextResponse, type NextRequest } from "next/server";
import { gate } from "./src/server/auth";

/**
 * Pages need the owner's session. /api routes check the key themselves (they answer JSON, not a
 * redirect), /signin is how you get a session, and static assets are public.
 */
export function proxy(request: NextRequest) {
  const h = request.headers;
  // Same decision as the API: session first, then a bearer key checked against the lockout first.
  const decision = gate(h);
  if (decision.ok) return undefined;
  if ("locked" in decision) return decision.locked;

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
