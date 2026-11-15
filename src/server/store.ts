import type { DatabaseSync } from "node:sqlite";
import { db as defaultDb } from "./db";
import type { Film, Prefs, Taste } from "../core/types";

/** Everything the person owns: prefs, marks, actions, events, the evening log. A thin layer over SQLite. */

export const DEFAULT_PREFS: Prefs = { providers: [], languages: ["en", "es"], subtitles: true };

export type Role = "seed" | "dislike" | "seen";
export type Action = "save" | "seen" | "dismiss";
export type EventType = "open" | "pick_shown";

export const EVENING_SOURCES = ["serendip", "netflix", "zapping", "other"] as const;
export type EveningSource = (typeof EVENING_SOURCES)[number];

export interface Evening {
  day: string;
  watched: string;
  source: EveningSource;
  enjoyment: number | null;
  minutesToChoose: number | null;
}

const now = () => Date.now();

export function createStore(d: DatabaseSync = defaultDb()) {
  const getKv = (key: string): string | null => (d.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
  const setKv = (key: string, value: string) => void d.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);

  const filmSnapshot = (f: Film | Taste) => void d.prepare("INSERT INTO films (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json").run(f.id, JSON.stringify(f));

  return {
    getPrefs(): Prefs {
      const raw = getKv("prefs");
      return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
    },
    hasPrefs(): boolean {
      return getKv("prefs") !== null;
    },
    setPrefs(p: Prefs): void {
      setKv("prefs", JSON.stringify(p));
    },

    /** Marks a film as loved / disliked / seen and keeps a snapshot of it. */
    mark(film: Film | Taste, role: Role, source: string, rating: number | null = null): void {
      filmSnapshot(film);
      d.prepare("INSERT INTO marks (film_id, role, rating, source, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(film_id, role) DO UPDATE SET rating = COALESCE(excluded.rating, marks.rating), source = excluded.source")
        .run(film.id, role, rating, source, now());
    },
    unmark(filmId: number, role: Role): void {
      d.prepare("DELETE FROM marks WHERE film_id = ? AND role = ?").run(filmId, role);
    },
    /** Snapshots of marked films for a role, newest first. */
    marked(role: Role): Array<{ film: Film | Taste; rating: number | null; source: string }> {
      const rows = d.prepare("SELECT f.json AS json, m.rating AS rating, m.source AS source FROM marks m JOIN films f ON f.id = m.film_id WHERE m.role = ? ORDER BY m.at DESC, m.film_id").all(role) as Array<{ json: string; rating: number | null; source: string }>;
      return rows.map((r) => ({ film: JSON.parse(r.json) as Film | Taste, rating: r.rating, source: r.source }));
    },
    /** Every film id that counts as seen: marked seen, or the Seen action. */
    seenIds(): Set<number> {
      const rows = d.prepare("SELECT film_id AS id FROM marks WHERE role = 'seen' UNION SELECT film_id FROM actions WHERE action = 'seen'").all() as Array<{ id: number }>;
      return new Set(rows.map((r) => r.id));
    },
    /** Seeds also count as seen: you cannot be shown what you loved. */
    ids(role: Role): Set<number> {
      return new Set((d.prepare("SELECT film_id AS id FROM marks WHERE role = ?").all(role) as Array<{ id: number }>).map((r) => r.id));
    },
    counts(): { seeds: number; seen: number } {
      const seen = this.seenIds();
      for (const id of this.ids("seed")) seen.add(id);
      return { seeds: this.ids("seed").size, seen: seen.size };
    },

    act(film: Film, action: Action): void {
      filmSnapshot(film);
      d.prepare("INSERT INTO actions (film_id, action, at) VALUES (?, ?, ?) ON CONFLICT(film_id, action) DO UPDATE SET at = excluded.at").run(film.id, action, now());
      if (action !== "save") d.prepare("DELETE FROM actions WHERE film_id = ? AND action = 'save'").run(film.id);
    },
    actionIds(action: Action): Set<number> {
      return new Set((d.prepare("SELECT film_id AS id FROM actions WHERE action = ?").all(action) as Array<{ id: number }>).map((r) => r.id));
    },
    savedFilms(): Film[] {
      const rows = d.prepare("SELECT f.json AS json FROM actions a JOIN films f ON f.id = a.film_id WHERE a.action = 'save' ORDER BY a.at DESC").all() as Array<{ json: string }>;
      return rows.map((r) => JSON.parse(r.json) as Film);
    },

    event(type: EventType, filmId: number | null = null, meta: Record<string, string | number> | null = null): void {
      d.prepare("INSERT INTO events (type, film_id, meta, at) VALUES (?, ?, ?, ?)").run(type, filmId, meta ? JSON.stringify(meta) : null, now());
    },

    addUnmatched(title: string, year: number | null, source: string): void {
      d.prepare("INSERT INTO unmatched (title, year, source, at) VALUES (?, ?, ?, ?)").run(title, year, source, now());
    },
    unmatched(): Array<{ title: string; year: number | null; source: string }> {
      return d.prepare("SELECT title, year, source FROM unmatched ORDER BY id DESC LIMIT 500").all() as Array<{ title: string; year: number | null; source: string }>;
    },
    clearUnmatched(source: string): void {
      d.prepare("DELETE FROM unmatched WHERE source = ?").run(source);
    },

    logEvening(e: Evening): void {
      d.prepare("INSERT INTO evenings (day, watched, source, enjoyment, minutes_to_choose, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET watched = excluded.watched, source = excluded.source, enjoyment = excluded.enjoyment, minutes_to_choose = excluded.minutes_to_choose, at = excluded.at")
        .run(e.day, e.watched, e.source, e.enjoyment, e.minutesToChoose, now());
    },
    evenings(limit = 60): Evening[] {
      const rows = d.prepare("SELECT day, watched, source, enjoyment, minutes_to_choose AS m FROM evenings ORDER BY day DESC LIMIT ?").all(limit) as Array<{ day: string; watched: string; source: EveningSource; enjoyment: number | null; m: number | null }>;
      return rows.map((r) => ({ day: r.day, watched: r.watched, source: r.source, enjoyment: r.enjoyment, minutesToChoose: r.m }));
    },
    hasEvening(day: string): boolean {
      return !!d.prepare("SELECT 1 AS x FROM evenings WHERE day = ?").get(day);
    },
    dismissedPrompt(day: string): boolean {
      return getKv("prompt_dismissed") === day;
    },
    dismissPrompt(day: string): void {
      setKv("prompt_dismissed", day);
    },

    /** Counters for `./check.sh usage`. */
    usage(): Record<string, string | number> {
      const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
      const { seeds, seen } = this.counts();
      const last = d.prepare("SELECT MAX(at) AS at FROM events WHERE type = 'open'").get() as { at: number | null };
      return {
        seeds,
        seen,
        picks_shown: one("SELECT COUNT(*) AS n FROM events WHERE type = 'pick_shown'"),
        opens: one("SELECT COUNT(*) AS n FROM events WHERE type = 'open'"),
        saves: one("SELECT COUNT(*) AS n FROM actions WHERE action = 'save'"),
        dismissals: one("SELECT COUNT(*) AS n FROM actions WHERE action = 'dismiss'"),
        evenings_logged: one("SELECT COUNT(*) AS n FROM evenings"),
        last_open: last.at ? new Date(last.at).toISOString() : "never",
      };
    },
    getKv,
    setKv,
  };
}

export type Store = ReturnType<typeof createStore>;
export const store = (): Store => createStore();
