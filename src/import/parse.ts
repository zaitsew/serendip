import { parseCsv } from "./csv";
import { readZip } from "./zip";

/** What an import file says before any TMDB lookup. Pure. */

export interface Entry {
  title: string;
  year: number | null;
  rating: number | null;
  liked: boolean;
}

export interface LetterboxdParsed {
  /** Every film the person has watched (watched.csv, ratings.csv, likes). */
  watched: Entry[];
  /** Films to seed taste from: rating >= 4 or liked. */
  seeds: Entry[];
}

const SEED_RATING = 4;

const key = (title: string, year: number | null) => `${title.toLowerCase()}|${year ?? ""}`;

function year(v: string | undefined): number | null {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 1870 && n < 2200 ? n : null;
}

export function parseLetterboxd(files: Map<string, Buffer>): LetterboxdParsed {
  const read = (suffix: string) => {
    for (const [name, buf] of files) if (name === suffix || name.endsWith(`/${suffix}`)) return parseCsv(buf.toString("utf8"));
    return [];
  };
  const all = new Map<string, Entry>();
  const touch = (r: Record<string, string>): Entry | null => {
    const title = r.Name?.trim();
    if (!title) return null;
    const y = year(r.Year);
    const k = key(title, y);
    let e = all.get(k);
    if (!e) { e = { title, year: y, rating: null, liked: false }; all.set(k, e); }
    return e;
  };
  for (const r of read("watched.csv")) touch(r);
  for (const r of read("ratings.csv")) {
    const e = touch(r);
    const n = Number.parseFloat(r.Rating ?? "");
    if (e && Number.isFinite(n)) e.rating = n;
  }
  for (const r of read("likes/films.csv")) {
    const e = touch(r);
    if (e) e.liked = true;
  }
  const watched = [...all.values()];
  const seeds = watched.filter((e) => e.liked || (e.rating ?? 0) >= SEED_RATING);
  return { watched, seeds };
}

export function parseLetterboxdZip(zip: Buffer): LetterboxdParsed {
  const needed = ["watched.csv", "ratings.csv", "likes/films.csv"];
  return parseLetterboxd(readZip(zip, { want: (name) => needed.some((n) => name === n || name.endsWith(`/${n}`)) }));
}

/** "Show: Season 2: Episode" (also Spanish "Temporada", Limited Series, Part, Volume, Book). */
const EPISODE = /:\s*(season|temporada|saison|staffel|stagione|series|limited series|miniserie|part|parte|volume|book|libro)\b[^:]*:/i;
const EPISODE_TAIL = /:\s*(season|temporada)\s*\d+\s*$/i;

export function looksLikeEpisode(title: string): boolean {
  return EPISODE.test(title) || EPISODE_TAIL.test(title);
}

/** Netflix ViewingActivity.csv (Title, Date): unique titles that do not look like series episodes. */
export function parseNetflix(text: string): { titles: string[]; skippedEpisodes: number } {
  const seen = new Set<string>();
  const titles: string[] = [];
  let skipped = 0;
  for (const r of parseCsv(text)) {
    const title = r.Title?.trim();
    if (!title) continue;
    if (looksLikeEpisode(title)) { skipped++; continue; }
    const k = title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    titles.push(title);
  }
  return { titles, skippedEpisodes: skipped };
}
