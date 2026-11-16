import type { DatabaseSync } from "node:sqlite";
import type { Ranked } from "../core/detour";
import { channelKey, DAY_MS } from "../core/detour";
import type { WatchedVideo } from "../core/takeout";
import type { VideoMeta } from "../core/topics";
import type { PendingAuth } from "../youtube/oauth";

/** A staged upload nobody committed is dropped after an hour. */
export const STAGE_TTL_MS = 60 * 60 * 1000;

/** The S2 half of the store: Takeout history, video metadata, quota days, Detour actions, OAuth state. */

export type DetourAction = "save" | "seen" | "dismiss";

export interface DetourPicks {
  day: string;
  builtAt: number;
  picks: Ranked[];
  /** Fields that were searched in the last run. */
  searched: string[];
  /** Why the last run stopped early, when it did. */
  note: string | null;
}

export interface PlaylistStatus { at: number; ok: boolean; added: number; removed: number; error: string | null; playlistId: string | null; picksBuiltAt?: number | null }

export interface SavedVideo { videoId: string; title: string | null; channelTitle: string | null; field: string | null }

type Kv = { get: (k: string) => string | null; set: (k: string, v: string) => void };

export function createYtStore(d: DatabaseSync, kv: Kv, now: () => number = Date.now) {
  const n = (sql: string, ...args: Array<string | number>) => (d.prepare(sql).get(...args) as { n: number }).n;
  const json = <T>(key: string): T | null => {
    const raw = kv.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  };

  return {
    /** The new file replaces the old history: Takeout always holds the whole of it. */
    replaceWatched(videos: WatchedVideo[]): void {
      d.exec("BEGIN");
      try {
        d.exec("DELETE FROM yt_watched");
        const ins = d.prepare("INSERT INTO yt_watched (video_id, title, channel, channel_id, last_at, plays) VALUES (?, ?, ?, ?, ?, ?)");
        for (const v of videos) ins.run(v.videoId, v.title, v.channel, v.channelId, v.lastAt, v.plays);
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
    /**
     * Holds one chunk of an upload. Uploads never clear each other: two tabs uploading at once each keep
     * their own chunks, and each commit swaps in only its own. An upload with no new chunk for STAGE_TTL_MS is dropped whole.
     */
    stageWatched(uploadId: string, videos: WatchedVideo[], now: number = Date.now()): { staged: number } {
      d.exec("BEGIN");
      try {
        // The clock is per upload, not per row: every chunk refreshes the whole upload, so cleanup removes
        // an upload whole or not at all and a commit never swaps in part of one.
        d.prepare("UPDATE yt_watched_stage SET staged_at = ? WHERE upload_id = ?").run(now, uploadId);
        d.prepare("DELETE FROM yt_watched_stage WHERE upload_id <> ? AND upload_id IN (SELECT upload_id FROM yt_watched_stage GROUP BY upload_id HAVING MAX(staged_at) < ?)").run(uploadId, now - STAGE_TTL_MS);
        const ins = d.prepare("INSERT OR REPLACE INTO yt_watched_stage (upload_id, video_id, title, channel, channel_id, last_at, plays, staged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        for (const v of videos) ins.run(uploadId, v.videoId, v.title, v.channel, v.channelId, v.lastAt, v.plays, now);
        const staged = n("SELECT COUNT(*) AS n FROM yt_watched_stage WHERE upload_id = ?", uploadId);
        d.exec("COMMIT");
        return { staged };
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
    stagedCount(uploadId: string): number { return n("SELECT COUNT(*) AS n FROM yt_watched_stage WHERE upload_id = ?", uploadId); },
    /** Swaps the staged upload in for the whole history. Returns null when nothing was staged under that id. */
    commitWatched(uploadId: string): { videos: number; channels: number } | null {
      d.exec("BEGIN");
      try {
        const staged = n("SELECT COUNT(*) AS n FROM yt_watched_stage WHERE upload_id = ?", uploadId);
        if (staged === 0) { d.exec("ROLLBACK"); return null; }
        d.exec("DELETE FROM yt_watched");
        d.prepare("INSERT INTO yt_watched (video_id, title, channel, channel_id, last_at, plays) SELECT video_id, title, channel, channel_id, last_at, plays FROM yt_watched_stage WHERE upload_id = ?").run(uploadId);
        d.prepare("DELETE FROM yt_watched_stage WHERE upload_id = ?").run(uploadId);
        const channels = n("SELECT COUNT(DISTINCT COALESCE(channel_id, channel)) AS n FROM yt_watched WHERE COALESCE(channel_id, channel) IS NOT NULL");
        d.exec("COMMIT");
        return { videos: staged, channels };
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    },
    watchedCount(): number { return n("SELECT COUNT(*) AS n FROM yt_watched"); },
    watchedIds(): Set<string> {
      return new Set((d.prepare("SELECT video_id AS id FROM yt_watched").all() as Array<{ id: string }>).map((r) => r.id));
    },
    /** Most recently watched video ids, newest first. */
    recentWatchedIds(limit: number): string[] {
      return (d.prepare("SELECT video_id AS id FROM yt_watched ORDER BY last_at DESC, video_id LIMIT ?").all(limit) as Array<{ id: string }>).map((r) => r.id);
    },
    /** Per-channel play counts, for the no-key cluster and the top-30 filter. */
    channelRows(): Array<{ channel: string | null; channelId: string | null; plays: number }> {
      return (d.prepare("SELECT channel, channel_id AS channelId, SUM(plays) AS plays FROM yt_watched GROUP BY channel, channel_id").all() as Array<{ channel: string | null; channelId: string | null; plays: number }>);
    },

    getMetas(ids: string[]): Map<string, VideoMeta> {
      const out = new Map<string, VideoMeta>();
      const sel = d.prepare("SELECT json FROM yt_meta WHERE video_id = ?");
      for (const id of ids) {
        const row = sel.get(id) as { json: string } | undefined;
        if (row) out.set(id, JSON.parse(row.json) as VideoMeta);
      }
      return out;
    },
    putMetas(metas: VideoMeta[]): void {
      const ins = d.prepare("INSERT INTO yt_meta (video_id, json) VALUES (?, ?) ON CONFLICT(video_id) DO UPDATE SET json = excluded.json");
      for (const m of metas) ins.run(m.videoId, JSON.stringify(m));
    },

    searchesToday(day: string): number {
      return (d.prepare("SELECT searches AS n FROM yt_usage WHERE day = ?").get(day) as { n: number } | undefined)?.n ?? 0;
    },
    unitsToday(day: string): number {
      return (d.prepare("SELECT units AS n FROM yt_usage WHERE day = ?").get(day) as { n: number } | undefined)?.n ?? 0;
    },
    /** Counts the calls before they are made, so a crash or an error never frees budget. */
    addUsage(day: string, searches: number, units: number): void {
      d.prepare("INSERT INTO yt_usage (day, searches, units) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET searches = searches + excluded.searches, units = units + excluded.units").run(day, searches, units);
    },

    getFields(): string[] { return json<string[]>("detour_fields") ?? []; },
    setFields(fields: string[]): void { kv.set("detour_fields", JSON.stringify(fields)); },
    getPicks(): DetourPicks | null { return json<DetourPicks>("detour_picks"); },
    setPicks(p: DetourPicks): void { kv.set("detour_picks", JSON.stringify(p)); },
    getAttempt(): { at: number; error: string | null } | null { return json("detour_attempt"); },
    setAttempt(a: { at: number; error: string | null }): void { kv.set("detour_attempt", JSON.stringify(a)); },
    getPlaylistStatus(): PlaylistStatus | null { return json<PlaylistStatus>("yt_playlist_status"); },
    setPlaylistStatus(s: PlaylistStatus): void { kv.set("yt_playlist_status", JSON.stringify(s)); },
    getPlaylistId(): string | null { return kv.get("yt_playlist_id"); },
    setPlaylistId(id: string): void { kv.set("yt_playlist_id", id); },
    clearPlaylistId(): void { d.prepare("DELETE FROM kv WHERE key = 'yt_playlist_id'").run(); },

    detourAct(a: { videoId: string; action: DetourAction; field: string | null; channelId: string | null; channelTitle: string | null; title: string | null }): void {
      const key = channelKey(a.channelId, a.channelTitle);
      d.prepare("INSERT INTO detour_actions (video_id, action, field, channel_key, title, channel_title, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET action = excluded.action, field = excluded.field, channel_key = excluded.channel_key, title = excluded.title, channel_title = excluded.channel_title, at = excluded.at")
        .run(a.videoId, a.action, a.field, key || null, a.title, a.channelTitle, now());
      if (a.action === "dismiss" && key) this.mute(key, 90);
    },
    mute(key: string, days: number): void {
      d.prepare("INSERT INTO detour_mutes (channel_key, until) VALUES (?, ?) ON CONFLICT(channel_key) DO UPDATE SET until = excluded.until").run(key, now() + days * DAY_MS);
    },
    mutedKeys(): Set<string> {
      return new Set((d.prepare("SELECT channel_key AS k FROM detour_mutes WHERE until > ?").all(now()) as Array<{ k: string }>).map((r) => r.k));
    },
    detourIds(action: DetourAction): Set<string> {
      return new Set((d.prepare("SELECT video_id AS id FROM detour_actions WHERE action = ?").all(action) as Array<{ id: string }>).map((r) => r.id));
    },
    /** Every video the owner has acted on, whatever the action: none of them comes back. */
    actedIds(): Set<string> {
      return new Set((d.prepare("SELECT video_id AS id FROM detour_actions").all() as Array<{ id: string }>).map((r) => r.id));
    },
    fieldDismissals(): Record<string, number> {
      const rows = d.prepare("SELECT field, COUNT(*) AS c FROM detour_actions WHERE action = 'dismiss' AND field IS NOT NULL GROUP BY field").all() as Array<{ field: string; c: number }>;
      return Object.fromEntries(rows.map((r) => [r.field, r.c]));
    },
    savedVideos(): SavedVideo[] {
      return (d.prepare("SELECT video_id AS videoId, title, channel_title AS channelTitle, field FROM detour_actions WHERE action = 'save' ORDER BY at DESC").all() as unknown as SavedVideo[]);
    },

    getPending(): PendingAuth | null { return json<PendingAuth>("yt_oauth_pending"); },
    setPending(p: PendingAuth): void { kv.set("yt_oauth_pending", JSON.stringify(p)); },
    clearPending(): void { d.prepare("DELETE FROM kv WHERE key = 'yt_oauth_pending'").run(); },
    /** The sealed (encrypted) refresh token; the plain token is never stored. */
    getSealedToken(): string | null { return kv.get("yt_refresh_sealed"); },
    setSealedToken(sealed: string): void { kv.set("yt_refresh_sealed", sealed); },
    clearToken(): void { d.prepare("DELETE FROM kv WHERE key IN ('yt_refresh_sealed', 'yt_playlist_id', 'yt_playlist_status')").run(); },

    ytUsage(day: string, connected: boolean): Record<string, number> {
      return {
        takeout_videos: n("SELECT COUNT(*) AS n FROM yt_watched"),
        detour_fields: this.getFields().length,
        detour_picks_shown: n("SELECT COUNT(*) AS n FROM events WHERE type = 'detour_shown'"),
        detour_watches: n("SELECT COUNT(*) AS n FROM events WHERE type = 'detour_watch'"),
        detour_dismissals: n("SELECT COUNT(*) AS n FROM detour_actions WHERE action = 'dismiss'"),
        search_calls_today: this.searchesToday(day),
        youtube_connected: connected ? 1 : 0,
      };
    },
  };
}
