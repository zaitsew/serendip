/**
 * Google OAuth 2.0, authorization code flow with PKCE, and the YouTube playlist calls that need it.
 * Everything here takes `fetch` as a parameter so tests stub the network.
 */
import { createHash, randomBytes } from "node:crypto";
import type { FetchFn } from "./api";
import type { PlaylistItem } from "../core/detour";

export const SCOPE = "https://www.googleapis.com/auth/youtube";
export const DEFAULT_REDIRECT = "http://localhost:3000/api/youtube/callback";
export const PLAYLIST_TITLE = "Serendip Detour";
export const STATE_TTL_MS = 10 * 60_000;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/youtube/v3";

const b64url = (b: Buffer) => b.toString("base64url");

export const newVerifier = () => b64url(randomBytes(48)); // 64 chars, inside the 43..128 PKCE range
export const newState = () => b64url(randomBytes(24));
export const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

export interface OAuthConfig { clientId: string; clientSecret: string; redirectUri: string }

export function oauthConfig(env: Record<string, string | undefined> = process.env): OAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT };
}

export function authUrl(cfg: OAuthConfig, state: string, verifier: string): string {
  const u = new URL(AUTH_URL);
  const p = u.searchParams;
  p.set("client_id", cfg.clientId);
  p.set("redirect_uri", cfg.redirectUri);
  p.set("response_type", "code");
  p.set("scope", SCOPE);
  p.set("state", state);
  p.set("code_challenge", challengeOf(verifier));
  p.set("code_challenge_method", "S256");
  p.set("access_type", "offline"); // we need a refresh token
  p.set("prompt", "consent"); // and Google only sends one on a consent screen
  return u.toString();
}

export interface PendingAuth { state: string; verifier: string; at: number }

/** The callback is valid only for the state we issued, once, and within ten minutes. */
export function checkState(pending: PendingAuth | null, returned: string | null, now: number): { ok: true; verifier: string } | { ok: false; reason: string } {
  if (!pending) return { ok: false, reason: "No sign-in was started. Press Connect YouTube again." };
  if (!returned) return { ok: false, reason: "Google sent no state." };
  if (now - pending.at > STATE_TTL_MS) return { ok: false, reason: "That sign-in took longer than ten minutes. Start again." };
  const a = Buffer.from(pending.state);
  const b = Buffer.from(returned);
  if (a.length !== b.length || !a.equals(b)) return { ok: false, reason: "The state did not match. Start again." };
  return { ok: true, verifier: pending.verifier };
}

export class OAuthError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "OAuthError"; }
}

async function tokenCall(f: FetchFn, params: Record<string, string>): Promise<{ access_token?: string; refresh_token?: string; scope?: string; expires_in?: number }> {
  let res: Response;
  try {
    res = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  } catch { throw new OAuthError("network", "Could not reach Google."); }
  const body = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; refresh_token?: string; scope?: string; expires_in?: number };
  if (!res.ok) throw new OAuthError(body.error ?? `http${res.status}`, `Google refused the token request (${body.error ?? res.status}).`);
  return body;
}

export async function exchangeCode(f: FetchFn, cfg: OAuthConfig, code: string, verifier: string): Promise<{ refreshToken: string }> {
  const t = await tokenCall(f, { grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, code_verifier: verifier });
  if (!t.refresh_token) throw new OAuthError("no_refresh_token", "Google sent no refresh token. Remove Serendip at myaccount.google.com/permissions and connect again.");
  if (!(t.scope ?? "").split(" ").includes(SCOPE)) throw new OAuthError("scope", "The YouTube permission was not granted.");
  return { refreshToken: t.refresh_token };
}

export async function accessToken(f: FetchFn, cfg: OAuthConfig, refreshToken: string): Promise<string> {
  const t = await tokenCall(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
  if (!t.access_token) throw new OAuthError("no_access_token", "Google sent no access token.");
  return t.access_token;
}

/** Revokes the token at Google. Returns whether Google accepted it. */
export async function revoke(f: FetchFn, token: string): Promise<boolean> {
  try {
    const res = await f(REVOKE_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) });
    return res.ok;
  } catch { return false; }
}

/** The calls the playlist sync needs. A fake implements this in tests. */
export interface PlaylistClient {
  /** The playlist's privacy status, or null when it does not exist (any more). */
  getPlaylist(id: string): Promise<{ privacy: string } | null>;
  createPlaylist(title: string, description: string): Promise<string>;
  listItems(playlistId: string): Promise<PlaylistItem[]>;
  deleteItem(itemId: string): Promise<void>;
  insertItem(playlistId: string, videoId: string, position: number): Promise<void>;
}

export function createPlaylistClient(f: FetchFn, token: string): PlaylistClient {
  const headers = { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" };
  const go = async (method: string, path: string, query: Record<string, string>, body?: unknown): Promise<Record<string, unknown>> => {
    const u = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    let res: Response;
    try { res = await f(u, { method, headers, body: body ? JSON.stringify(body) : undefined }); } catch { throw new OAuthError("network", "Could not reach YouTube."); }
    if (res.status === 204) return {};
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { errors?: Array<{ reason?: string }> } };
    if (!res.ok) {
      const reason = data.error?.errors?.[0]?.reason ?? `http${res.status}`;
      throw new OAuthError(reason, `YouTube refused the playlist call (${reason}).`);
    }
    return data;
  };
  return {
    async getPlaylist(id) {
      let d: { items?: Array<{ id: string; status?: { privacyStatus?: string } }> };
      try {
        d = (await go("GET", "playlists", { part: "status", id, maxResults: "1" })) as typeof d;
      } catch (e) {
        // A playlist the owner deleted is "gone", not a failure: the sync then creates a new private one.
        if (e instanceof OAuthError && (e.code === "playlistNotFound" || e.code === "http404")) return null;
        throw e;
      }
      const hit = d.items?.find((p) => p.id === id);
      return hit ? { privacy: hit.status?.privacyStatus ?? "unknown" } : null;
    },
    async createPlaylist(title, description) {
      const d = (await go("POST", "playlists", { part: "snippet,status" }, { snippet: { title, description }, status: { privacyStatus: "private" } })) as { id?: string };
      if (!d.id) throw new OAuthError("no_playlist", "YouTube returned no playlist id.");
      return d.id;
    },
    async listItems(playlistId) {
      const out: PlaylistItem[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 20; page++) {
        const q: Record<string, string> = { part: "contentDetails", playlistId, maxResults: "50" };
        if (pageToken) q.pageToken = pageToken;
        const d = (await go("GET", "playlistItems", q)) as { items?: Array<{ id: string; contentDetails?: { videoId?: string } }>; nextPageToken?: string };
        for (const it of d.items ?? []) out.push({ itemId: it.id, videoId: it.contentDetails?.videoId ?? "" });
        pageToken = d.nextPageToken;
        if (!pageToken) break;
      }
      return out;
    },
    async deleteItem(itemId) {
      await go("DELETE", "playlistItems", { id: itemId });
    },
    async insertItem(playlistId, videoId, position) {
      await go("POST", "playlistItems", { part: "snippet" }, { snippet: { playlistId, position, resourceId: { kind: "youtube#video", videoId } } });
    },
  };
}
