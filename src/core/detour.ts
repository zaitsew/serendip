/**
 * The Detour lane: filter, rank and choose. Pure and deterministic. No network, no clock (callers pass `now`).
 */
import { clusterOverlap } from "./topics";

export const DAILY_SEARCH_BUDGET = 12;
/** Quota units, assumed. search.list is the expensive call. */
export const SEARCH_COST = 100;
export const LIST_COST = 1;
export const PLAYLIST_WRITE_COST = 50;

export const MAX_FIELDS = 8;
export const DAY_MS = 86_400_000;

/** Tunable. Change them here, the tests read these constants. */
export const DETOUR = {
  keep: 12,
  /** Under this many seconds a video is a Short or a clip. */
  minSeconds: 240,
  minViews: 20_000,
  minLikeRatio: 0.015,
  /** Dropped when more than this share of its topics sit inside the main cluster. */
  maxClusterOverlap: 0.5,
  topChannels: 30,
  muteDays: 90,
  searchWindowYears: 3,
  /** A field's score drops by this much per "Not for me" on it, up to `maxFieldDismissals`. */
  fieldPenalty: 0.15,
  maxFieldDismissals: 5,
  /** Score weights. */
  wLike: 0.4,
  wViews: 0.35,
  wFresh: 0.25,
  /** Like ratio at or above this scores 1. */
  likeCeiling: 0.06,
  /** Views at or above 10^this score 1. */
  viewsCeilingLog: 7,
  /** When the owner hides likes, assume this ratio rather than punish or reward. */
  unknownLikeRatio: 0.03,
} as const;

export interface Candidate {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string;
  field: string;
  publishedAt: string;
  seconds: number;
  views: number;
  likes: number | null;
  topics: string[];
}

export interface DetourContext {
  now: number;
  watched: Set<string>;
  /** Top watched channels, by id and by lower-case name (Takeout has names, sometimes ids). */
  topChannelIds: Set<string>;
  topChannelNames: Set<string>;
  /** Muted channels (key = channel id, or lower-case name when there is no id). */
  muted: Set<string>;
  /** Labels of the main cluster (see mainCluster). */
  cluster: Set<string>;
  /** Count of "Not for me" per field. */
  fieldDismissals: Record<string, number>;
}

export const channelKey = (id: string | null, title: string | null) => (id ? id : (title ?? "").trim().toLowerCase());

export type DropReason = "short" | "watched" | "top-channel" | "muted" | "cluster" | "low-quality";

export function dropReason(c: Candidate, ctx: DetourContext): DropReason | null {
  if (c.seconds < DETOUR.minSeconds) return "short";
  if (ctx.watched.has(c.videoId)) return "watched";
  if ((c.channelId && ctx.topChannelIds.has(c.channelId)) || ctx.topChannelNames.has(c.channelTitle.trim().toLowerCase())) return "top-channel";
  if (ctx.muted.has(channelKey(c.channelId, c.channelTitle)) || (c.channelId && ctx.muted.has(c.channelTitle.trim().toLowerCase()))) return "muted";
  if (clusterOverlap(c.topics, ctx.cluster) > DETOUR.maxClusterOverlap) return "cluster";
  if (c.views < DETOUR.minViews) return "low-quality";
  if (c.likes !== null && c.likes / c.views < DETOUR.minLikeRatio) return "low-quality";
  return null;
}

export function filterCandidates(cands: Candidate[], ctx: DetourContext): Candidate[] {
  return cands.filter((c) => dropReason(c, ctx) === null);
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Higher is better. Like ratio, log views, freshness, minus the field penalty. Channel diversity is applied in selectDetour. */
export function score(c: Candidate, ctx: Pick<DetourContext, "now" | "fieldDismissals">): number {
  const ratio = c.likes === null ? DETOUR.unknownLikeRatio : c.likes / Math.max(1, c.views);
  const like = clamp01(ratio / DETOUR.likeCeiling);
  const views = clamp01(Math.log10(Math.max(1, c.views)) / DETOUR.viewsCeilingLog);
  const published = Date.parse(c.publishedAt);
  const ageYears = Number.isFinite(published) ? Math.max(0, ctx.now - published) / (365 * DAY_MS) : DETOUR.searchWindowYears;
  const fresh = clamp01(1 - ageYears / DETOUR.searchWindowYears);
  const dismissed = Math.min(ctx.fieldDismissals[c.field] ?? 0, DETOUR.maxFieldDismissals);
  return DETOUR.wLike * like + DETOUR.wViews * views + DETOUR.wFresh * fresh - DETOUR.fieldPenalty * dismissed;
}

export interface Ranked extends Candidate { score: number }

/**
 * Filter, score, keep the best video per channel, then deal the videos round-robin across fields.
 * Fields are served in order of their best score, so a field you keep dismissing deals last.
 */
export function selectDetour(cands: Candidate[], ctx: DetourContext, keep: number = DETOUR.keep): Ranked[] {
  const seen = new Set<string>();
  const ranked: Ranked[] = [];
  for (const c of filterCandidates(cands, ctx)) {
    if (seen.has(c.videoId)) continue;
    seen.add(c.videoId);
    ranked.push({ ...c, score: score(c, ctx) });
  }
  const byScore = (a: Ranked, b: Ranked) => b.score - a.score || a.videoId.localeCompare(b.videoId);
  ranked.sort(byScore);

  // One video per channel, across all fields.
  const channels = new Set<string>();
  const diverse = ranked.filter((c) => {
    const k = channelKey(c.channelId, c.channelTitle);
    if (channels.has(k)) return false;
    channels.add(k);
    return true;
  });

  const lanes = new Map<string, Ranked[]>();
  for (const c of diverse) (lanes.get(c.field) ?? lanes.set(c.field, []).get(c.field)!).push(c);
  const order = [...lanes.entries()].sort((a, b) => byScore(a[1][0]!, b[1][0]!)).map(([, list]) => list);

  const out: Ranked[] = [];
  for (let round = 0; out.length < keep && order.some((l) => l[round]); round++) {
    for (const lane of order) {
      const c = lane[round];
      if (c && out.length < keep) out.push(c);
    }
  }
  return out;
}

/** Top watched channels by plays, ties by name. */
export function topChannels(rows: Array<{ channel: string | null; channelId: string | null; plays: number }>, n: number = DETOUR.topChannels): { ids: Set<string>; names: Set<string> } {
  const byName = new Map<string, { plays: number; ids: Set<string> }>();
  for (const r of rows) {
    if (!r.channel) continue;
    const key = r.channel.trim().toLowerCase();
    const e = byName.get(key) ?? { plays: 0, ids: new Set<string>() };
    e.plays += r.plays;
    if (r.channelId) e.ids.add(r.channelId);
    byName.set(key, e);
  }
  const top = [...byName.entries()].sort((a, b) => b[1].plays - a[1].plays || a[0].localeCompare(b[0])).slice(0, n);
  return { ids: new Set(top.flatMap(([, e]) => [...e.ids])), names: new Set(top.map(([name]) => name)) };
}

/** Normalise the owner's fields: trim, collapse spaces, drop empties and duplicates, cap at MAX_FIELDS. */
export function cleanFields(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const f = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (f.length < 2 || seen.has(f.toLowerCase())) continue;
    seen.add(f.toLowerCase());
    out.push(f);
    if (out.length === MAX_FIELDS) break;
  }
  return out;
}

export type Duration = "medium" | "long";
export interface SearchTask { field: string; duration: Duration }

/**
 * Which search.list calls to make. The API takes one videoDuration per call, so a field gets "medium"
 * first (4 to 20 minutes); "long" calls follow while budget is left. `offset` rotates the fields so a
 * second run on the same day starts where the first stopped. Never more than `budget` tasks.
 */
export function planSearches(fields: string[], budget: number, offset = 0): SearchTask[] {
  if (fields.length === 0 || budget <= 0) return [];
  const n = fields.length;
  const rotated = Array.from({ length: n }, (_, i) => fields[(i + (((offset % n) + n) % n)) % n]!);
  const tasks: SearchTask[] = [...rotated.map((field) => ({ field, duration: "medium" as const })), ...rotated.map((field) => ({ field, duration: "long" as const }))];
  return tasks.slice(0, budget);
}

/** The day the YouTube quota resets on: midnight Pacific. */
export function quotaDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** How many of `want` calls the budget still allows today. */
export function allowedSearches(usedToday: number, want: number, budget: number = DAILY_SEARCH_BUDGET): number {
  return Math.max(0, Math.min(want, budget - usedToday));
}

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export interface WhyInput { field: string; clusterTop: { label: string; share: number } | null }

/** "Physics · away from Travel (62 % of your history)". */
export function detourWhy({ field, clusterTop }: WhyInput): string {
  if (!clusterTop) return `${field} · outside your usual`;
  return `${field} · away from ${clusterTop.label} (${Math.round(clusterTop.share * 100)} % of your history)`;
}

/** Preview start second: the same video always lands on the same second, a little way in. */
export const previewStart = (videoId: string) => 20 + (hash(videoId) % 60);

const safeId = (id: string) => encodeURIComponent(id);

/** youtube-nocookie embed. Muted autoplay preview while zapping, sound and controls once you pressed Watch. */
export function detourEmbed(videoId: string, mode: "preview" | "watch"): string {
  const id = safeId(videoId);
  if (mode === "watch") return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&controls=1&rel=0&playsinline=1&modestbranding=1&disablekb=1`;
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1&playlist=${id}&modestbranding=1&start=${previewStart(videoId)}`;
}

export interface PlaylistItem { itemId: string; videoId: string }
export interface PlaylistPlan { remove: string[]; add: Array<{ videoId: string; position: number }> }

/**
 * Turn the playlist into today's list. Items that are not in today's list, and duplicates, go; videos
 * already there stay (a delete or insert costs 50 quota units); missing ones are inserted at their rank.
 */
export function planPlaylistSync(existing: PlaylistItem[], desired: string[]): PlaylistPlan {
  const want = new Set(desired);
  const kept = new Set<string>();
  const remove: string[] = [];
  for (const it of existing) {
    if (want.has(it.videoId) && !kept.has(it.videoId)) kept.add(it.videoId);
    else remove.push(it.itemId);
  }
  const add = desired.map((videoId, position) => ({ videoId, position })).filter((a) => !kept.has(a.videoId));
  return { remove, add };
}
