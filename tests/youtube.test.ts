import { describe, expect, it } from "vitest";
import { createPlaylistClient, challengeOf, checkState, newState, newVerifier, OAuthError, SCOPE, STATE_TTL_MS, authUrl, exchangeCode, accessToken, revoke, type PlaylistClient } from "../src/youtube/oauth";
import { createYoutube, parseDuration, YoutubeError } from "../src/youtube/api";
import { decryptSecret, encryptSecret } from "../src/server/crypto";
import { beginConnect, disconnect, finishConnect, syncPlaylist, syncToYoutube, type DetourDeps } from "../src/server/detour";
import { openDb } from "../src/server/db";
import { createStore } from "../src/server/store";
import type { PlaylistItem } from "../src/core/detour";

const cfg = { clientId: "cid", clientSecret: "csecret", redirectUri: "http://localhost:3000/api/youtube/callback" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("PKCE and state", () => {
  it("matches the RFC 7636 example challenge", () => {
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("makes long random verifiers and states", () => {
    const v = newVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(newVerifier()).not.toBe(v);
    expect(newState()).not.toBe(newState());
  });
  it("builds an auth URL with PKCE S256, offline access and the YouTube scope", () => {
    const u = new URL(authUrl(cfg, "st", "ver"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("code_challenge")).toBe(challengeOf("ver"));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe(SCOPE);
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(u.searchParams.has("client_secret")).toBe(false);
  });
  it("accepts only the issued state, within ten minutes", () => {
    const pending = { state: "abc", verifier: "ver", at: 1000 };
    expect(checkState(pending, "abc", 2000)).toEqual({ ok: true, verifier: "ver" });
    expect(checkState(pending, "abd", 2000)).toMatchObject({ ok: false });
    expect(checkState(pending, null, 2000)).toMatchObject({ ok: false });
    expect(checkState(null, "abc", 2000)).toMatchObject({ ok: false });
    expect(checkState(pending, "abc", 1000 + STATE_TTL_MS + 1)).toMatchObject({ ok: false });
    expect(checkState(pending, "abcd", 2000)).toMatchObject({ ok: false });
  });
});

describe("token encryption", () => {
  it("round-trips, and ciphertext differs every time", () => {
    const a = encryptSecret("1//refresh-token", "owner-key");
    const b = encryptSecret("1//refresh-token", "owner-key");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token");
    expect(decryptSecret(a, "owner-key")).toBe("1//refresh-token");
  });
  it("refuses a wrong key, a tampered value and garbage", () => {
    const sealed = encryptSecret("tok", "owner-key");
    expect(decryptSecret(sealed, "other-key")).toBeNull();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(parts.join("."), "owner-key")).toBeNull();
    expect(decryptSecret("nonsense", "owner-key")).toBeNull();
  });
});

function deps(over: Partial<DetourDeps> = {}): DetourDeps {
  return { yt: null, oauth: cfg, ownerKey: "owner-key", fetch: (async () => json({})) as unknown as typeof fetch, now: () => 5_000_000, ...over };
}

describe("connect flow", () => {
  it("stores the state, then the sealed refresh token after a valid callback, and uses the verifier", async () => {
    const s = createStore(openDb(":memory:"));
    const url = new URL(beginConnect(s, deps())!);
    const state = url.searchParams.get("state")!;
    let body = "";
    const f = (async (_u: string, init?: RequestInit) => { body = String(init?.body); return json({ access_token: "at", refresh_token: "rt-secret", scope: SCOPE, expires_in: 3600 }); }) as unknown as typeof fetch;
    const r = await finishConnect(s, deps({ fetch: f }), { state, code: "the-code", error: null });
    expect(r).toEqual({ ok: true });
    const params = new URLSearchParams(body);
    expect(params.get("grant_type")).toBe("authorization_code");
    expect(params.get("code")).toBe("the-code");
    expect(params.get("code_verifier")).toBeTruthy();
    expect(challengeOf(params.get("code_verifier")!)).toBe(url.searchParams.get("code_challenge"));
    const sealed = s.yt.getSealedToken()!;
    expect(sealed).not.toContain("rt-secret");
    expect(decryptSecret(sealed, "owner-key")).toBe("rt-secret");
    expect(s.yt.getPending()).toBeNull();
    expect(s.usage().youtube_connected).toBe(1);
  });

  it("rejects a wrong state and does not store a token; a replayed callback finds nothing", async () => {
    const s = createStore(openDb(":memory:"));
    const url = new URL(beginConnect(s, deps())!);
    let called = 0;
    const f = (async () => { called++; return json({ access_token: "a", refresh_token: "r", scope: SCOPE }); }) as unknown as typeof fetch;
    expect(await finishConnect(s, deps({ fetch: f }), { state: "forged", code: "c", error: null })).toMatchObject({ ok: false });
    expect(called).toBe(0);
    expect(s.yt.getSealedToken()).toBeNull();
    // The failed attempt consumed the pending state: the real state no longer works either.
    expect(await finishConnect(s, deps({ fetch: f }), { state: url.searchParams.get("state"), code: "c", error: null })).toMatchObject({ ok: false });
  });

  it("refuses a grant without the YouTube scope or without a refresh token", async () => {
    const f = (body: unknown) => (async () => json(body)) as unknown as typeof fetch;
    await expect(exchangeCode(f({ refresh_token: "r", scope: "email" }), cfg, "c", "v")).rejects.toThrow(/permission/);
    await expect(exchangeCode(f({ access_token: "a", scope: SCOPE }), cfg, "c", "v")).rejects.toBeInstanceOf(OAuthError);
  });

  it("disconnect revokes at Google and deletes the token locally even when Google fails", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setSealedToken(encryptSecret("rt", "owner-key"));
    const seen: string[] = [];
    const ok = (async (u: string, init?: RequestInit) => { seen.push(`${u} ${String(init?.body)}`); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
    expect(await disconnect(s, deps({ fetch: ok }))).toEqual({ revoked: true });
    expect(seen[0]).toContain("oauth2.googleapis.com/revoke");
    expect(seen[0]).toContain("token=rt");
    expect(s.yt.getSealedToken()).toBeNull();
    s.yt.setSealedToken(encryptSecret("rt", "owner-key"));
    const bad = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await disconnect(s, deps({ fetch: bad }))).toEqual({ revoked: false });
    expect(s.yt.getSealedToken()).toBeNull();
    expect(await revoke(bad, "x")).toBe(false);
  });

  it("exchanges a refresh token for an access token", async () => {
    const f = (async (_u: string, init?: RequestInit) => { expect(String(init?.body)).toContain("grant_type=refresh_token"); return json({ access_token: "at" }); }) as unknown as typeof fetch;
    expect(await accessToken(f, cfg, "rt")).toBe("at");
  });
});

/** In-memory playlists with a call log. `lists` maps playlist id to privacy and items. */
function fakePlaylist(seed: Record<string, { privacy: string; items: PlaylistItem[] }> = {}) {
  const log: string[] = [];
  const lists = new Map(Object.entries(seed).map(([id, v]) => [id, { privacy: v.privacy, items: [...v.items] }]));
  let next = 100;
  let created = 0;
  const client: PlaylistClient = {
    async getPlaylist(id) { log.push(`get ${id}`); const l = lists.get(id); return l ? { privacy: l.privacy } : null; },
    async createPlaylist(t) { const id = `NEW${++created}`; log.push(`create ${t}`); lists.set(id, { privacy: "private", items: [] }); return id; },
    async listItems(id) {
      log.push(`list ${id}`);
      const l = lists.get(id);
      if (!l) throw new OAuthError("playlistNotFound", "gone");
      return [...l.items];
    },
    async deleteItem(id) { log.push(`delete ${id}`); for (const l of lists.values()) l.items = l.items.filter((i) => i.itemId !== id); },
    async insertItem(p, videoId, position) { log.push(`insert ${p}:${videoId}@${position}`); const l = lists.get(p)!; l.items.splice(Math.min(position, l.items.length), 0, { itemId: `n${next++}`, videoId }); },
  };
  return { client, log, videos: (id: string) => lists.get(id)!.items.map((i) => i.videoId) };
}

describe("playlist sync", () => {
  it("creates a private playlist when none is stored and inserts every video", async () => {
    const s = createStore(openDb(":memory:"));
    const f = fakePlaylist();
    const r = await syncPlaylist(f.client, s, ["A", "B", "C"]);
    expect(r).toEqual({ added: 3, removed: 0, playlistId: "NEW1" });
    expect(f.log[0]).toBe("create Serendip Detour");
    expect(f.videos("NEW1")).toEqual(["A", "B", "C"]);
    expect(s.yt.getPlaylistId()).toBe("NEW1");
  });

  it("never writes to a public playlist, even one with the same title: it creates a private one instead", async () => {
    const s = createStore(openDb(":memory:"));
    const f = fakePlaylist({ PUB: { privacy: "public", items: [{ itemId: "i1", videoId: "OLD" }] } });
    s.yt.setPlaylistId("PUB"); // e.g. the owner made it public later
    const r = await syncPlaylist(f.client, s, ["A"]);
    expect(r.playlistId).toBe("NEW1");
    expect(f.videos("PUB")).toEqual(["OLD"]); // untouched
    expect(f.log.some((l) => /^(insert|delete) PUB/.test(l) || l === "delete i1")).toBe(false);
    expect(s.yt.getPlaylistId()).toBe("NEW1");
    // Unlisted counts as not private too.
    const g = fakePlaylist({ UN: { privacy: "unlisted", items: [] } });
    s.yt.setPlaylistId("UN");
    expect((await syncPlaylist(g.client, s, ["A"])).playlistId).toBe("NEW1");
  });

  it("does not adopt a playlist it did not create: with no stored id it never looks one up by title", async () => {
    const s = createStore(openDb(":memory:"));
    const f = fakePlaylist({ SOMEONES: { privacy: "private", items: [] } });
    await syncPlaylist(f.client, s, ["A"]);
    expect(f.log.some((l) => l.includes("SOMEONES"))).toBe(false);
    expect(s.yt.getPlaylistId()).toBe("NEW1");
  });

  it("deletes old items first, then inserts, and ends with exactly today's list", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setPlaylistId("PL1");
    const f = fakePlaylist({ PL1: { privacy: "private", items: [{ itemId: "i1", videoId: "OLD1" }, { itemId: "i2", videoId: "KEEP" }, { itemId: "i3", videoId: "OLD2" }] } });
    const r = await syncPlaylist(f.client, s, ["NEW1", "KEEP", "NEW2"]);
    expect(r).toMatchObject({ added: 2, removed: 2 });
    const firstInsert = f.log.findIndex((l) => l.startsWith("insert"));
    const lastDelete = f.log.map((l) => l.startsWith("delete")).lastIndexOf(true);
    expect(lastDelete).toBeLessThan(firstInsert);
    expect([...f.videos("PL1")].sort()).toEqual(["KEEP", "NEW1", "NEW2"]);
    expect(f.log).not.toContain("delete i2"); // an overlapping video is kept, saving 50 quota units
  });

  it("creates a new private playlist when the stored one is gone", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setPlaylistId("DEAD");
    const f = fakePlaylist();
    const r = await syncPlaylist(f.client, s, ["A", "B"]);
    expect(r).toMatchObject({ added: 2, removed: 0, playlistId: "NEW1" });
    expect(s.yt.getPlaylistId()).toBe("NEW1");
  });

  it("syncToYoutube records the result, and drops a revoked token", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setSealedToken(encryptSecret("rt", "owner-key"));
    const f = fakePlaylist({ PL1: { privacy: "private", items: [] } });
    s.yt.setPlaylistId("PL1");
    const tokenFetch = (async () => json({ access_token: "at" })) as unknown as typeof fetch;
    expect(await syncToYoutube(s, deps({ fetch: tokenFetch, playlist: () => f.client }), ["A", "B"])).toBe("synced");
    expect(s.yt.getPlaylistStatus()).toMatchObject({ ok: true, added: 2, removed: 0 });
    const revoked = (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    expect(await syncToYoutube(s, deps({ fetch: revoked, playlist: () => f.client }), ["A"])).toBe("failed");
    expect(s.yt.getSealedToken()).toBeNull();
  });

  it("does nothing without a connection or without videos", async () => {
    const s = createStore(openDb(":memory:"));
    expect(await syncToYoutube(s, deps(), ["A"])).toBe("off");
    s.yt.setSealedToken(encryptSecret("rt", "owner-key"));
    expect(await syncToYoutube(s, deps(), [])).toBe("skipped");
  });

  it("the HTTP playlist client sends private status, bearer auth and the video resource", async () => {
    const reqs: Array<{ url: string; method: string; auth: string; body: unknown }> = [];
    const f = (async (u: URL, init?: RequestInit) => {
      reqs.push({ url: String(u), method: String(init?.method), auth: (init?.headers as Record<string, string>).authorization!, body: init?.body ? JSON.parse(String(init.body)) : null });
      return String(u).includes("/playlists") && init?.method === "POST" ? json({ id: "PL9" }) : json({});
    }) as unknown as typeof fetch;
    const c = createPlaylistClient(f, "tok");
    expect(await c.createPlaylist("Serendip Detour", "d")).toBe("PL9");
    await c.insertItem("PL9", "dQw4w9WgXcQ", 3);
    expect(reqs[0]).toMatchObject({ method: "POST", auth: "Bearer tok", body: { status: { privacyStatus: "private" } } });
    expect(reqs[1]!.body).toEqual({ snippet: { playlistId: "PL9", position: 3, resourceId: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" } } });
  });
});

describe("YouTube Data API client", () => {
  it("parses ISO durations", () => {
    expect(parseDuration("PT4M")).toBe(240);
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("P1DT1S")).toBe(86401);
    expect(parseDuration("P0D")).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
  });

  it("asks videos.list for the parts and ids, and marks missing videos as not found", async () => {
    let url = "";
    const f = (async (u: URL) => { url = String(u); return json({ items: [{ id: "aaaaaaaaaaa", snippet: { categoryId: "19", channelId: "UC1", channelTitle: "C", title: "T" }, contentDetails: { duration: "PT10M" }, topicDetails: { topicCategories: ["https://en.wikipedia.org/wiki/Tourism"] }, statistics: { viewCount: "1000", likeCount: "50" } }] }); }) as unknown as typeof fetch;
    const out = await createYoutube({ key: "K", fetch: f }).videos(["aaaaaaaaaaa", "bbbbbbbbbbb", "bad"], ["topicDetails", "snippet", "contentDetails"]);
    const u = new URL(url);
    expect(u.pathname).toBe("/youtube/v3/videos");
    expect(u.searchParams.get("part")).toBe("topicDetails,snippet,contentDetails");
    expect(u.searchParams.get("id")).toBe("aaaaaaaaaaa,bbbbbbbbbbb"); // invalid ids never reach the API
    expect(out[0]).toMatchObject({ found: true, categoryId: "19", seconds: 600, views: 1000, likes: 50 });
    expect(out[1]).toMatchObject({ videoId: "bbbbbbbbbbb", found: false });
  });

  it("searches with the documented parameters", async () => {
    let url = "";
    const f = (async (u: URL) => { url = String(u); return json({ items: [{ id: { videoId: "aaaaaaaaaaa" }, snippet: { title: "T", channelId: "UC1", channelTitle: "C", publishedAt: "2026-01-01T00:00:00Z" } }, { id: {} }] }); }) as unknown as typeof fetch;
    const hits = await createYoutube({ key: "K", fetch: f }).search({ q: "physics", duration: "long", language: "es", publishedAfter: "2023-11-15T00:00:00.000Z" });
    const p = new URL(url).searchParams;
    expect(Object.fromEntries(p)).toMatchObject({ type: "video", q: "physics", videoDuration: "long", safeSearch: "moderate", order: "relevance", relevanceLanguage: "es", publishedAfter: "2023-11-15T00:00:00.000Z", videoEmbeddable: "true" });
    expect(hits).toHaveLength(1);
  });

  it("raises a quota error without leaking the key", async () => {
    const f = (async () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)) as unknown as typeof fetch;
    try {
      await createYoutube({ key: "SECRET-KEY", fetch: f }).search({ q: "x", duration: "medium", language: null, publishedAfter: "2023-01-01T00:00:00Z" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(YoutubeError);
      expect((e as YoutubeError).quota).toBe(true);
      expect(String((e as Error).message)).not.toContain("SECRET-KEY");
    }
  });
});
