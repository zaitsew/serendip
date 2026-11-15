import {
  allowedSearches, DAILY_SEARCH_BUDGET, DAY_MS, DETOUR, detourWhy, LIST_COST, PLAYLIST_WRITE_COST, planPlaylistSync, planSearches, quotaDay, SEARCH_COST, selectDetour, topChannels,
  type Candidate, type DetourContext, type Ranked,
} from "../core/detour";
import { dedupeWatched, parseTakeout, type TakeoutResult } from "../core/takeout";
import { channelHistogram, mainCluster, percent, suggestFields, topicHistogram, type Bar, type ChannelBar, type ScoredSuggestion, type VideoMeta } from "../core/topics";
import { createYoutube, toCandidate, YoutubeError, youtubeKey, type FetchFn, type YoutubeClient } from "../youtube/api";
import {
  accessToken, authUrl, checkState, createPlaylistClient, exchangeCode, newState, newVerifier, OAuthError, oauthConfig, PLAYLIST_TITLE, revoke,
  type OAuthConfig, type PlaylistClient,
} from "../youtube/oauth";
import { ownerKey } from "./auth";
import { decryptSecret, encryptSecret } from "./crypto";
import type { Store } from "./store";

/** The glue for sprint 2: Takeout import, the cluster, the daily Detour channel, the optional playlist. */

export const HISTORY_LIMIT = 2000;
export const MAX_HISTORY_CALLS = 40;
/** After a failed run, wait this long before the next lazy attempt (a manual refresh ignores it). */
export const RETRY_AFTER_MS = 30 * 60_000;

export interface DetourDeps {
  yt: YoutubeClient | null;
  oauth: OAuthConfig | null;
  ownerKey: string | null;
  fetch: FetchFn;
  now: () => number;
  /** Builds the playlist client; tests replace it with a fake. */
  playlist?: (token: string) => PlaylistClient;
}

export function depsFromEnv(env: Record<string, string | undefined> = process.env): DetourDeps {
  const key = youtubeKey(env);
  return { yt: key ? createYoutube({ key }) : null, oauth: oauthConfig(env), ownerKey: ownerKey(env), fetch, now: Date.now };
}

// --- Takeout ---------------------------------------------------------------

export interface TakeoutReport {
  rows: number;
  videos: number;
  channels: number;
  skipped: TakeoutResult["skipped"];
  /** The cluster step ran (a key is set) and how it went. */
  analysis: AnalysisReport | null;
}

export function importTakeout(store: Store, text: string): Omit<TakeoutReport, "analysis"> {
  const parsed = parseTakeout(text);
  const videos = dedupeWatched(parsed.entries);
  store.yt.replaceWatched(videos);
  return { rows: parsed.rows, videos: videos.length, channels: new Set(videos.map((v) => v.channelId ?? v.channel).filter(Boolean)).size, skipped: parsed.skipped };
}

export interface AnalysisReport { calls: number; fetched: number; cached: number; missing: number; stoppedBy: string | null }

/** videos.list on the most recent watched videos that are not cached yet. At most 40 calls, 1 unit each. */
export async function analyzeHistory(store: Store, deps: Pick<DetourDeps, "yt" | "now">): Promise<AnalysisReport> {
  const report: AnalysisReport = { calls: 0, fetched: 0, cached: 0, missing: 0, stoppedBy: null };
  if (!deps.yt) return { ...report, stoppedBy: "no_key" };
  const ids = store.yt.recentWatchedIds(HISTORY_LIMIT);
  const have = store.yt.getMetas(ids);
  report.cached = have.size;
  const todo = ids.filter((id) => !have.has(id));
  const day = quotaDay(deps.now());
  for (let i = 0; i < todo.length && report.calls < MAX_HISTORY_CALLS; i += 50) {
    const chunk = todo.slice(i, i + 50);
    store.yt.addUsage(day, 0, LIST_COST);
    report.calls++;
    try {
      const got = await deps.yt.videos(chunk, ["snippet", "contentDetails", "topicDetails"]);
      store.yt.putMetas(got.map(({ videoId, found, categoryId, topics, channelId, channelTitle, title, seconds }): VideoMeta => ({ videoId, found, categoryId, topics, channelId, channelTitle, title, seconds })));
      report.fetched += got.filter((g) => g.found).length;
      report.missing += got.filter((g) => !g.found).length;
    } catch (e) {
      report.stoppedBy = e instanceof YoutubeError ? e.reason : "error";
      break;
    }
  }
  return report;
}

// --- The cluster -------------------------------------------------------------

export interface ClusterView {
  mode: "topics" | "channels" | "none";
  /** Videos in the history, and how many of the latest 2000 have topic data. */
  watched: number;
  analyzed: number;
  headline: string | null;
  topics: Bar[];
  categories: Bar[];
  channels: ChannelBar[];
  /** The biggest specific topic, used in "away from ...". */
  top: { label: string; share: number } | null;
  needsAnalysis: boolean;
}

export function clusterView(store: Store, keyed: boolean): ClusterView {
  const watched = store.yt.watchedCount();
  const empty: ClusterView = { mode: "none", watched, analyzed: 0, headline: null, topics: [], categories: [], channels: [], top: null, needsAnalysis: false };
  if (watched === 0) return empty;
  const ids = store.yt.recentWatchedIds(HISTORY_LIMIT);
  const metas = [...store.yt.getMetas(ids).values()];
  const h = topicHistogram(metas);
  const ch = channelHistogram(store.yt.channelRows());
  const needsAnalysis = keyed && metas.length < ids.length;
  if (h.total > 0) {
    const cluster = mainCluster(h);
    const lead = (cluster.length ? cluster : h.topics.filter((t) => t.share > 0).slice(0, 3)).slice(0, 3);
    return {
      mode: "topics", watched, analyzed: h.total,
      headline: `Your last ${h.total.toLocaleString("en-US")} videos: ${lead.map((t) => `${percent(t.share)} ${t.label}`).join(", ")}`,
      topics: h.topics.slice(0, 12), categories: h.categories.slice(0, 8), channels: ch.channels.slice(0, 10),
      top: cluster[0] ? { label: cluster[0].label, share: cluster[0].share } : null, needsAnalysis,
    };
  }
  const first = ch.channels.slice(0, 3);
  return {
    mode: "channels", watched, analyzed: 0,
    headline: first.length ? `Your ${ch.total.toLocaleString("en-US")} watches by channel: ${first.map((c) => `${percent(c.share)} ${c.channel}`).join(", ")}` : null,
    topics: [], categories: [], channels: ch.channels.slice(0, 10), top: ch.channels[0] ? { label: ch.channels[0].channel, share: ch.channels[0].share } : null, needsAnalysis,
  };
}

// --- Fields and the Detour run --------------------------------------------------

export function detourContext(store: Store, now: number): DetourContext {
  const ids = store.yt.recentWatchedIds(HISTORY_LIMIT);
  const h = topicHistogram([...store.yt.getMetas(ids).values()]);
  const top = topChannels(store.yt.channelRows());
  return {
    now,
    watched: new Set([...store.yt.watchedIds(), ...store.yt.actedIds()]),
    topChannelIds: top.ids,
    topChannelNames: top.names,
    muted: store.yt.mutedKeys(),
    cluster: new Set(mainCluster(h).map((t) => t.label)),
    fieldDismissals: store.yt.fieldDismissals(),
  };
}

const withoutScore = ({ score, ...c }: Ranked): Candidate => { void score; return c; };

const LANG: Record<string, string> = { zh: "zh-Hans", cn: "zh-Hant" };
const language = (code: string | undefined) => (code ? (LANG[code] ?? code) : null);

export type RefreshStatus = "sample" | "no_fields" | "fresh" | "waiting" | "budget" | "built" | "error";
export interface RefreshResult { status: RefreshStatus; picks: number; searchCalls: number; note: string | null; playlist: "off" | "synced" | "failed" | "skipped" }

const summary = (status: RefreshStatus, picks: number, searchCalls: number, note: string | null, playlist: RefreshResult["playlist"] = "off"): RefreshResult => ({ status, picks, searchCalls, note, playlist });

/**
 * Build today's picks. Lazy by default (does nothing when today's picks exist); `force` is the manual
 * refresh. Either way the daily search budget decides how many search.list calls happen.
 */
export async function refreshDetour(store: Store, deps: DetourDeps, opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const now = deps.now();
  const day = quotaDay(now);
  const existing = store.yt.getPicks();
  if (!deps.yt) return summary("sample", 0, 0, "Add YOUTUBE_API_KEY to search.");
  const fields = store.yt.getFields();
  if (fields.length === 0) return summary("no_fields", 0, 0, "Name a field first.");
  if (!opts.force) {
    if (existing?.day === day) return summary("fresh", existing.picks.length, 0, null);
    const attempt = store.yt.getAttempt();
    if (attempt?.error && now - attempt.at < RETRY_AFTER_MS) return summary("waiting", existing?.picks.length ?? 0, 0, attempt.error);
  }

  const used = store.yt.searchesToday(day);
  if (DAILY_SEARCH_BUDGET - used <= 0) {
    return summary("budget", existing?.picks.length ?? 0, 0, `The ${DAILY_SEARCH_BUDGET} searches for today are used. The quota resets at midnight Pacific.`);
  }
  const prefs = store.getPrefs();
  const lang = language(prefs.languages[0]);
  const publishedAfter = new Date(now - DETOUR.searchWindowYears * 365 * DAY_MS).toISOString();
  const tasks = planSearches(fields, allowedSearches(used, 2 * fields.length), used);
  const ctx = detourContext(store, now);

  const hits = new Map<string, { hit: Awaited<ReturnType<YoutubeClient["search"]>>[number]; field: string }>();
  let calls = 0;
  let note: string | null = null;
  let failed = false;
  const searchedOk = new Set<string>(); // fields with at least one search that came back
  for (const task of tasks) {
    if (store.yt.searchesToday(day) >= DAILY_SEARCH_BUDGET) break;
    store.yt.addUsage(day, 1, SEARCH_COST); // counted before the call: an error never frees budget
    calls++;
    try {
      for (const hit of await deps.yt.search({ q: task.field, duration: task.duration, language: lang, publishedAfter })) {
        if (!hits.has(hit.videoId) && !ctx.watched.has(hit.videoId)) hits.set(hit.videoId, { hit, field: task.field });
      }
      searchedOk.add(task.field);
    } catch (e) {
      failed = true;
      note = e instanceof YoutubeError ? (e.quota ? "YouTube says the daily quota is used up." : e.message) : "Search failed.";
      if (e instanceof YoutubeError && e.quota) break;
    }
  }

  const candidates: Candidate[] = [];
  const all = [...hits.keys()];
  try {
    for (let i = 0; i < all.length; i += 50) {
      store.yt.addUsage(day, 0, LIST_COST);
      const details = await deps.yt.videos(all.slice(i, i + 50), ["statistics", "contentDetails", "topicDetails"]);
      for (const d of details) {
        const h = hits.get(d.videoId);
        const c = h ? toCandidate(h.hit, d, h.field) : null;
        if (c) candidates.push(c);
      }
    }
  } catch (e) {
    failed = true;
    note = note ?? (e instanceof YoutubeError ? e.message : "Could not read video details.");
  }

  // Keep the earlier picks of every field this run did not get an answer for (a quota error, a failed
  // search, or a budget that ran out before the field was reached). Fields that were searched are replaced.
  const carried: Candidate[] = existing ? existing.picks.filter((p) => fields.includes(p.field) && !searchedOk.has(p.field)).map((p) => withoutScore(p)) : [];
  const picks = selectDetour([...candidates, ...carried], ctx);

  if (failed && picks.length === 0 && candidates.length === 0) {
    store.yt.setAttempt({ at: now, error: note ?? "The run failed." });
    return summary("error", existing?.picks.length ?? 0, calls, note);
  }
  store.yt.setAttempt({ at: now, error: null });
  store.yt.setPicks({ day, builtAt: now, picks, searched: [...new Set(tasks.slice(0, calls).map((t) => t.field))], note });
  const playlist = await syncToYoutube(store, deps, picks.map((p) => p.videoId));
  return summary("built", picks.length, calls, note, playlist);
}

// --- The playlist ------------------------------------------------------------------

export function isConnected(store: Store): boolean {
  return store.yt.getSealedToken() !== null;
}

/**
 * Make the playlist Serendip created hold exactly `videoIds`. A playlist is used only while its id is the
 * one we stored after creating it AND it is still private. Anything else (a public playlist that happens
 * to share the title, one the owner made public later, one that was deleted) is left alone and a new
 * private one is created. Never writes to a non-private playlist.
 */
export async function syncPlaylist(client: PlaylistClient, store: Store, videoIds: string[]): Promise<{ added: number; removed: number; playlistId: string | null }> {
  let id = store.yt.getPlaylistId();
  if (id) {
    const info = await client.getPlaylist(id);
    if (!info || info.privacy !== "private") { store.yt.clearPlaylistId(); id = null; }
  }
  if (!id) {
    if (videoIds.length === 0) return { added: 0, removed: 0, playlistId: null }; // nothing to clear, nothing to create
    id = await client.createPlaylist(PLAYLIST_TITLE, "Videos from outside your usual. Rewritten daily by Serendip.");
    store.yt.setPlaylistId(id);
  }
  let existing: Awaited<ReturnType<PlaylistClient["listItems"]>>;
  try {
    existing = await client.listItems(id);
  } catch (e) {
    if (!(e instanceof OAuthError) || e.code !== "playlistNotFound") throw e;
    store.yt.clearPlaylistId();
    return syncPlaylist(client, store, videoIds);
  }
  const plan = planPlaylistSync(existing, videoIds);
  for (const itemId of plan.remove) await client.deleteItem(itemId); // old items first
  for (const a of plan.add) await client.insertItem(id, a.videoId, a.position);
  return { added: plan.add.length, removed: plan.remove.length, playlistId: id };
}

export async function syncToYoutube(store: Store, deps: DetourDeps, videoIds: string[]): Promise<RefreshResult["playlist"]> {
  const sealed = store.yt.getSealedToken();
  if (!sealed || !deps.oauth || !deps.ownerKey) return "off";
  if (videoIds.length === 0) return "skipped";
  const at = deps.now();
  const fail = (error: string) => { store.yt.setPlaylistStatus({ at, ok: false, added: 0, removed: 0, error, playlistId: store.yt.getPlaylistId() }); return "failed" as const; };
  const refresh = decryptSecret(sealed, deps.ownerKey);
  if (!refresh) { store.yt.clearToken(); return fail("The stored YouTube token cannot be read (the owner key changed). Connect YouTube again."); }
  try {
    const token = await accessToken(deps.fetch, deps.oauth, refresh);
    const client = deps.playlist ? deps.playlist(token) : createPlaylistClient(deps.fetch, token);
    const r = await syncPlaylist(client, store, videoIds);
    store.yt.addUsage(quotaDay(at), 0, (r.added + r.removed) * PLAYLIST_WRITE_COST + 2 * LIST_COST);
    store.yt.setPlaylistStatus({ at, ok: true, added: r.added, removed: r.removed, error: null, playlistId: r.playlistId });
    return "synced";
  } catch (e) {
    if (e instanceof OAuthError && e.code === "invalid_grant") {
      store.yt.clearToken();
      return fail("Google revoked the access. Connect YouTube again.");
    }
    return fail(e instanceof OAuthError ? e.message : "The playlist update failed.");
  }
}

export function beginConnect(store: Store, deps: DetourDeps): string | null {
  if (!deps.oauth) return null;
  const state = newState();
  const verifier = newVerifier();
  store.yt.setPending({ state, verifier, at: deps.now() });
  return authUrl(deps.oauth, state, verifier);
}

export async function finishConnect(store: Store, deps: DetourDeps, params: { state: string | null; code: string | null; error: string | null }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pending = store.yt.getPending();
  store.yt.clearPending(); // one use: a replayed callback finds nothing
  if (!deps.oauth || !deps.ownerKey) return { ok: false, reason: "YouTube sign-in is not set up on this server." };
  const checked = checkState(pending, params.state, deps.now());
  if (!checked.ok) return checked;
  if (params.error) return { ok: false, reason: params.error === "access_denied" ? "You declined the YouTube permission." : "Google returned an error." };
  if (!params.code) return { ok: false, reason: "Google sent no code." };
  try {
    const { refreshToken } = await exchangeCode(deps.fetch, deps.oauth, params.code, checked.verifier);
    store.yt.setSealedToken(encryptSecret(refreshToken, deps.ownerKey));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof OAuthError ? e.message : "Could not finish the sign-in." };
  }
}

/** Revokes at Google, then deletes the token here whatever Google answered. */
export async function disconnect(store: Store, deps: DetourDeps): Promise<{ revoked: boolean }> {
  const sealed = store.yt.getSealedToken();
  let revoked = false;
  if (sealed && deps.ownerKey) {
    const token = decryptSecret(sealed, deps.ownerKey);
    if (token) revoked = await revoke(deps.fetch, token);
  }
  store.yt.clearToken();
  store.yt.clearPending();
  return { revoked };
}

// --- What the pages read ------------------------------------------------------------

export interface FeedVideo {
  key: string;
  videoId: string | null;
  title: string;
  channel: string;
  channelId: string | null;
  field: string;
  why: string;
  seconds: number | null;
  views: number | null;
  placeholder: boolean;
}

export const SAMPLE_FIELDS = ["Physics", "Architecture history", "Ocean science", "Jazz", "Typography", "Medieval history"];

export function samplePicks(): FeedVideo[] {
  return SAMPLE_FIELDS.map((field, i) => ({
    key: `sample:${i}`, videoId: null, title: `Sample card: ${field}`, channel: "Sample, not a real video", channelId: null, field,
    why: `Sample · ${field} · add YOUTUBE_API_KEY for real videos`, seconds: null, views: null, placeholder: true,
  }));
}

export function pickView(p: Ranked, top: { label: string; share: number } | null): FeedVideo {
  return { key: `v:${p.videoId}`, videoId: p.videoId, title: p.title, channel: p.channelTitle, channelId: p.channelId, field: p.field, why: detourWhy({ field: p.field, clusterTop: top }), seconds: p.seconds, views: p.views, placeholder: false };
}

/** The Detour channel for /tv: sample cards without a key, today's picks with one, nothing when there is nothing to show. */
export function detourPicks(store: Store, deps: Pick<DetourDeps, "yt">): { sample: boolean; picks: FeedVideo[] } {
  if (!deps.yt) return { sample: true, picks: samplePicks() };
  const stored = store.yt.getPicks();
  if (!stored) return { sample: false, picks: [] };
  const top = clusterView(store, true).top;
  const gone = store.yt.actedIds();
  const muted = store.yt.mutedKeys();
  return {
    sample: false,
    picks: stored.picks.filter((p) => !gone.has(p.videoId) && !muted.has(p.channelId ?? p.channelTitle.trim().toLowerCase())).map((p) => pickView(p, top)),
  };
}

export interface DetourState {
  keyed: boolean;
  oauth: { configured: boolean; connected: boolean; redirectUri: string | null; playlist: ReturnType<Store["yt"]["getPlaylistStatus"]> };
  cluster: ClusterView;
  fields: string[];
  suggestions: ScoredSuggestion[];
  picks: { sample: boolean; day: string | null; builtAt: number | null; note: string | null; items: FeedVideo[] };
  budget: { used: number; limit: number; units: number };
  saved: ReturnType<Store["yt"]["savedVideos"]>;
}

export function detourState(store: Store, deps: DetourDeps): DetourState {
  const keyed = !!deps.yt;
  const day = quotaDay(deps.now());
  const cluster = clusterView(store, keyed);
  const fields = store.yt.getFields();
  const stored = store.yt.getPicks();
  const p = detourPicks(store, deps);
  const ids = store.yt.recentWatchedIds(HISTORY_LIMIT);
  const hist = topicHistogram([...store.yt.getMetas(ids).values()]);
  return {
    keyed,
    oauth: { configured: !!deps.oauth, connected: isConnected(store), redirectUri: deps.oauth?.redirectUri ?? null, playlist: store.yt.getPlaylistStatus() },
    cluster,
    fields,
    suggestions: suggestFields(hist.total > 0 ? hist : null, fields),
    picks: { sample: p.sample, day: stored?.day ?? null, builtAt: stored?.builtAt ?? null, note: stored?.note ?? null, items: p.picks },
    budget: { used: store.yt.searchesToday(day), limit: DAILY_SEARCH_BUDGET, units: store.yt.unitsToday(day) },
    saved: store.yt.savedVideos(),
  };
}
