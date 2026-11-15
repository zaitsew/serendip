import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Access is one owner key. SERENDIP_OWNER_KEY gates every page and every API route.
 *  - The web sign-in stores an HMAC of the key in an httpOnly cookie, never the key.
 *  - API clients send `Authorization: Bearer <key>`.
 *  - No key set: nothing gets in. There is no localhost exemption, because the dev server is reachable
 *    from the Wi-Fi when you run it with `-H 0.0.0.0` for the TV.
 *  - Wrong keys are counted per client. A valid key or session always passes; the lockout only refuses
 *    requests that failed to authenticate, so one client's failures cannot block another's valid ones.
 */

export const COOKIE_NAME = "serendip_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
const SESSION_LABEL = "serendip-session-v1";

type Env = Record<string, string | undefined>;

export function ownerKey(env: Env = process.env): string | null {
  const key = env.SERENDIP_OWNER_KEY?.trim();
  return key ? key : null;
}

export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function sessionValue(key: string): string {
  return createHmac("sha256", key).update(SESSION_LABEL).digest("hex");
}

export function isOwnerKey(candidate: string | null | undefined, env: Env = process.env): boolean {
  const key = ownerKey(env);
  return !!key && !!candidate && safeEqual(candidate, key);
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    // The TV opens http://<mac-ip>:3000, so the cookie cannot be Secure unless a proxy serves https.
    secure: env.SERENDIP_SECURE_COOKIE === "1",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

export interface AuthInput {
  cookie?: string | null;
  authorization?: string | null;
}

export type AuthResult =
  | { ok: true; via: "cookie" | "bearer" }
  | { ok: false; status: 401 | 503; error: string; presented: boolean };

let warned = false;

/** Pure decision: who is this request? `presented` is true when it carried a wrong bearer key. */
export function authenticate(input: AuthInput, env: Env = process.env): AuthResult {
  const key = ownerKey(env);
  if (!key) {
    if (!warned) {
      warned = true;
      console.warn("\nSERENDIP_OWNER_KEY is not set. Every page and API route refuses all requests. Set it in .env and restart.\n");
    }
    return { ok: false, status: 503, error: "SERENDIP_OWNER_KEY is not set on this server.", presented: false };
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() ?? "")?.[1]?.trim();
  if (bearer && safeEqual(bearer, key)) return { ok: true, via: "bearer" };
  const cookie = readCookie(input.cookie, COOKIE_NAME);
  if (cookie && safeEqual(cookie, sessionValue(key))) return { ok: true, via: "cookie" };
  return { ok: false, status: 401, error: "Send `Authorization: Bearer <SERENDIP_OWNER_KEY>` or sign in at /signin.", presented: !!bearer };
}

/** Only same-site paths survive; anything else becomes "/". */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  try {
    const u = new URL(value, "http://x");
    if (u.origin !== "http://x" || u.pathname.startsWith("//")) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

/** Counts wrong keys per client in a fixed window. `locked` is asked before the key is looked at. */
export function createLockout(opts: { perKey: number; windowMs: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let window = Math.floor(now() / opts.windowMs);
  const fails = new Map<string, number>();
  const roll = () => {
    const w = Math.floor(now() / opts.windowMs);
    if (w !== window) { window = w; fails.clear(); }
  };
  return {
    locked(key: string): boolean { roll(); return (fails.get(key) ?? 0) >= opts.perKey; },
    fail(key: string): void { roll(); fails.set(key, (fails.get(key) ?? 0) + 1); },
    reset(): void { fails.clear(); },
  };
}

const g = globalThis as unknown as { __serendipLockout?: ReturnType<typeof createLockout> };
export const lockout = () => (g.__serendipLockout ??= createLockout({ perKey: 10, windowMs: 10 * 60_000 }));

/** The client address. Forwarded headers count only behind a proxy you control (SERENDIP_TRUST_PROXY=1). */
export function clientIp(headers: Headers, env: Env = process.env): string {
  if (env.SERENDIP_TRUST_PROXY === "1") return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // Without a trusted proxy a forwarded header is client-supplied and would let a guesser pick a fresh
  // bucket each time. The socket address is not visible to route handlers, so failures share one bucket.
  return "shared";
}

export type GateResult =
  | { ok: true }
  | { ok: false; locked: Response }
  | { ok: false; status: 401 | 503; error: string };

/**
 * The decision for every page and API request.
 *  - A valid session cookie always passes, so other people's wrong keys never lock out a signed-in owner.
 *  - A bearer key is checked against the lockout BEFORE it is compared. A locked-out guesser gets 429
 *    even for the right key, so guessing has a hard attempt limit.
 *  - Sign-in (app/signin/actions.ts) follows the same order. Without SERENDIP_TRUST_PROXY all failures
 *    share one bucket, so someone on your network can delay a NEW sign-in for ten minutes; an existing
 *    session is unaffected. Behind a proxy you control, set SERENDIP_TRUST_PROXY=1 for per-IP buckets.
 */
export function gate(headers: Headers, env: Env = process.env): GateResult {
  const session = authenticate({ cookie: headers.get("cookie") }, env);
  if (session.ok) return { ok: true };
  if (session.status === 503) return { ok: false, status: 503, error: session.error };
  const authorization = headers.get("authorization");
  if (!/^Bearer\s+\S/i.test(authorization?.trim() ?? "")) return { ok: false, status: 401, error: session.error };
  const ip = clientIp(headers, env);
  if (lockout().locked(ip)) return { ok: false, locked: json(429, "Too many wrong keys. Wait ten minutes.", { "Retry-After": "600" }) };
  const bearer = authenticate({ authorization }, env);
  if (bearer.ok) return { ok: true };
  lockout().fail(ip);
  return { ok: false, status: 401, error: bearer.error };
}

/** `null` when the request is the owner's; otherwise the 401/429/503 response to return. */
export function requireOwner(request: Request): Response | null {
  const res = gate(request.headers);
  if (res.ok) return null;
  return "locked" in res ? res.locked : json(res.status, res.error);
}

function json(status: number, error: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
