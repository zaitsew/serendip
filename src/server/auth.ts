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

/**
 * The throttle for a request that did NOT authenticate: a 429 when its client is locked out, otherwise
 * `null` after counting a wrong bearer key against that client. A request that authenticates never gets
 * here, so other people's wrong keys can never lock the owner out.
 */
export function throttleFailure(headers: Headers, presented: boolean): Response | null {
  const ip = clientIp(headers);
  if (ownerKey() && lockout().locked(ip)) return json(429, "Too many wrong keys. Wait ten minutes.", { "Retry-After": "600" });
  if (presented) lockout().fail(ip);
  return null;
}

/** `null` when the request is the owner's; otherwise the 401/429/503 response to return. */
export function requireOwner(request: Request): Response | null {
  const r = authenticate({ cookie: request.headers.get("cookie"), authorization: request.headers.get("authorization") });
  if (r.ok) return null;
  return throttleFailure(request.headers, r.presented) ?? json(r.status, r.error);
}

function json(status: number, error: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
}
