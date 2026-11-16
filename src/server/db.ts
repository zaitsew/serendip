import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * One local SQLite file (node:sqlite, Node 24+). SERENDIP_DB overrides the path; ":memory:" is for tests.
 * One owner, so there is no user_id: the file is the tenant.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, fetched_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- A snapshot of every film the person told us about, so seeds and seen work offline.
CREATE TABLE IF NOT EXISTS films (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
-- role: seed (loved), dislike, seen
CREATE TABLE IF NOT EXISTS marks (film_id INTEGER NOT NULL, role TEXT NOT NULL, rating REAL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (film_id, role));
-- action: save, seen, dismiss
CREATE TABLE IF NOT EXISTS actions (film_id INTEGER NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (film_id, action));
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, film_id INTEGER, meta TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_type ON events (type, at);
CREATE TABLE IF NOT EXISTS evenings (day TEXT PRIMARY KEY, watched TEXT NOT NULL, source TEXT NOT NULL, enjoyment INTEGER, minutes_to_choose INTEGER, at INTEGER NOT NULL);
-- S2: the Takeout watch history, one row per video (repeat watches add to plays).
CREATE TABLE IF NOT EXISTS yt_watched (video_id TEXT PRIMARY KEY, title TEXT NOT NULL, channel TEXT, channel_id TEXT, last_at INTEGER NOT NULL, plays INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS yt_watched_at ON yt_watched (last_at);
-- Takeout chunks land here first and replace yt_watched in one transaction, so a failed upload never leaves half a history.
CREATE TABLE IF NOT EXISTS yt_watched_stage (upload_id TEXT NOT NULL, video_id TEXT NOT NULL, title TEXT NOT NULL, channel TEXT, channel_id TEXT, last_at INTEGER NOT NULL, plays INTEGER NOT NULL, staged_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (upload_id, video_id));
-- videos.list metadata for watched videos, cached forever (found = false is cached too).
CREATE TABLE IF NOT EXISTS yt_meta (video_id TEXT PRIMARY KEY, json TEXT NOT NULL);
-- YouTube quota days (Pacific): search calls made and units assumed.
CREATE TABLE IF NOT EXISTS yt_usage (day TEXT PRIMARY KEY, searches INTEGER NOT NULL DEFAULT 0, units INTEGER NOT NULL DEFAULT 0);
-- action: save, seen, dismiss. One row per video; the newest action wins.
CREATE TABLE IF NOT EXISTS detour_actions (video_id TEXT PRIMARY KEY, action TEXT NOT NULL, field TEXT, channel_key TEXT, title TEXT, channel_title TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS detour_mutes (channel_key TEXT PRIMARY KEY, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS unmatched (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, year INTEGER, source TEXT NOT NULL, at INTEGER NOT NULL);
`;

export function dbPath(env: Record<string, string | undefined> = process.env): string {
  return env.SERENDIP_DB?.trim() || resolve(process.cwd(), "data", "serendip.db");
}

export function openDb(path: string = dbPath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  // A staging table created before staged_at existed (dev databases only) gets the column.
  const cols = db.prepare("PRAGMA table_info(yt_watched_stage)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "staged_at")) db.exec("ALTER TABLE yt_watched_stage ADD COLUMN staged_at INTEGER NOT NULL DEFAULT 0");
  return db;
}

const g = globalThis as unknown as { __serendipDb?: DatabaseSync };
export function db(): DatabaseSync {
  return (g.__serendipDb ??= openDb());
}
