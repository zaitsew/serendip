/**
 * Google Takeout `watch-history.json` parser. Pure: text in, entries out.
 *
 * Kept: YouTube watch entries with a real video id. Ignored, and counted: Google Ads entries, removed
 * videos, YouTube Music entries, and anything that is not a watch (searches, community posts).
 */

export interface TakeoutEntry {
  videoId: string;
  title: string;
  channel: string | null;
  channelId: string | null;
  /** Epoch milliseconds, 0 when the entry has no usable time. */
  at: number;
}

export interface TakeoutResult {
  entries: TakeoutEntry[];
  /** Number of rows in the file, before any filtering. */
  rows: number;
  skipped: { ads: number; music: number; removed: number; other: number };
}

export class TakeoutError extends Error {
  constructor(readonly code: "html" | "empty" | "invalid" | "search" | "no_watches", message: string) {
    super(message);
    this.name = "TakeoutError";
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character id from a watch, youtu.be, shorts or embed URL; null for anything else. */
export function videoIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    if (!id) {
      const m = /^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  } else if (host === "youtu.be") {
    id = u.pathname.split("/")[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

function channelIdFromUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /\/channel\/(UC[A-Za-z0-9_-]{20,})/.exec(url);
  return m?.[1] ?? null;
}

const looksLikeHtml = (text: string) => /^\s*(<!doctype html|<html|<\?xml|<head|<body)/i.test(text.slice(0, 400));

export function parseTakeout(text: string): TakeoutResult {
  if (!text.trim()) throw new TakeoutError("empty", "That file is empty.");
  if (looksLikeHtml(text)) {
    throw new TakeoutError("html", "That is the HTML export. In Google Takeout, open the YouTube format option and choose JSON, then upload watch-history.json.");
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new TakeoutError("invalid", "That file is not valid JSON. Upload watch-history.json from the Takeout ZIP (YouTube and YouTube Music, history, JSON)."); }
  if (!Array.isArray(raw)) throw new TakeoutError("invalid", "Expected a JSON list of watch entries (watch-history.json).");

  const skipped = { ads: 0, music: 0, removed: 0, other: 0 };
  let searches = 0;
  const entries: TakeoutEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") { skipped.other++; continue; }
    const r = row as Record<string, unknown>;
    const details = Array.isArray(r.details) ? (r.details as Array<{ name?: unknown }>) : [];
    if (details.some((d) => typeof d?.name === "string" && /google ads/i.test(d.name))) { skipped.ads++; continue; }
    const products = Array.isArray(r.products) ? r.products : [];
    if (r.header === "YouTube Music" || products.includes("YouTube Music")) { skipped.music++; continue; }
    const title = typeof r.title === "string" ? r.title : "";
    const videoId = videoIdFromUrl(r.titleUrl);
    if (!videoId) {
      if (/^Searched for /i.test(title) || (typeof r.titleUrl === "string" && /youtube\.com\/results\?.*search_query=/i.test(r.titleUrl))) searches++;
      if (/^Watched a video that has been removed/i.test(title) || (/^Watched /i.test(title) && !r.titleUrl)) skipped.removed++;
      else skipped.other++;
      continue;
    }
    if (!/^Watched /i.test(title) && title) { skipped.other++; continue; } // "Visited ..." and similar
    const sub = Array.isArray(r.subtitles) ? (r.subtitles as Array<{ name?: unknown; url?: unknown }>)[0] : undefined;
    const at = typeof r.time === "string" ? Date.parse(r.time) : NaN;
    entries.push({
      videoId,
      title: title.replace(/^Watched /i, "").slice(0, 200),
      channel: typeof sub?.name === "string" && sub.name ? sub.name.slice(0, 120) : null,
      channelId: channelIdFromUrl(sub?.url),
      at: Number.isFinite(at) ? at : 0,
    });
  }
  // Never hand back something that would replace a good history with nothing, or with search terms.
  if (searches > 0 && searches > entries.length) {
    throw new TakeoutError("search", "That looks like search-history.json, not the watch history. In Google Takeout choose the YouTube history called watch-history (JSON) and upload watch-history.json.");
  }
  if (entries.length === 0) {
    throw new TakeoutError("no_watches", `No watched videos were found in that file (${raw.length} rows, none a YouTube watch). Your existing history was not changed. Upload watch-history.json from Takeout.`);
  }
  return { entries, rows: raw.length, skipped };
}

export interface WatchedVideo { videoId: string; title: string; channel: string | null; channelId: string | null; lastAt: number; plays: number }

/** One row per video: repeat watches add to `plays` and keep the latest time. */
export function dedupeWatched(entries: TakeoutEntry[]): WatchedVideo[] {
  const byId = new Map<string, WatchedVideo>();
  for (const e of entries) {
    const w = byId.get(e.videoId);
    if (!w) byId.set(e.videoId, { videoId: e.videoId, title: e.title, channel: e.channel, channelId: e.channelId, lastAt: e.at, plays: 1 });
    else {
      w.plays++;
      if (e.at >= w.lastAt) { w.lastAt = e.at; w.title = e.title || w.title; w.channel = e.channel ?? w.channel; w.channelId = e.channelId ?? w.channelId; }
    }
  }
  return [...byId.values()];
}
