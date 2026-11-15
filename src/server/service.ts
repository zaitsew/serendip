import type { Catalog, SearchHit } from "../catalog";
import { pickMatch } from "../core/match";
import { buildChannels } from "../core/rank";
import type { Channel, Film, Provider, Taste } from "../core/types";
import { parseLetterboxdZip, parseNetflix, type Entry } from "../import/parse";
import type { Store } from "./store";

/** The glue between the store, the catalog and the pure ranking. */

const MAX_SEEDS_ENRICHED = 25;
const MAX_IMPORT = 2000;

export const isFilm = (x: Film | Taste): x is Film => "recommendations" in x;

export function tasteOf(x: Film | Taste, rating: number | null = null): Taste {
  return { id: x.id, title: x.title, year: x.year, genres: x.genres, country: x.country, rating: "rating" in x ? x.rating : rating };
}

export function tasteFromHit(h: SearchHit, rating: number | null): Taste {
  return { id: h.id, title: h.title, year: h.year, genres: h.genres, country: h.country, rating };
}

/** Everything that shapes the usual cluster: seeds, films marked seen, and films you pressed "Already seen" on. */
export function tastesOf(store: Store): Taste[] {
  const tastes: Taste[] = [];
  const counted = new Set<number>();
  const rows = [...store.marked("seed"), ...store.marked("seen"), ...store.seenActionFilms().map((film) => ({ film, rating: null as number | null }))];
  for (const row of rows) {
    if (counted.has(row.film.id)) continue;
    counted.add(row.film.id);
    tastes.push(tasteOf(row.film, row.rating));
  }
  return tastes;
}

export interface Feed {
  mode: Catalog["mode"];
  channels: Channel[];
  needsSetup: boolean;
}

export async function buildFeed(store: Store, catalog: Catalog): Promise<Feed> {
  const prefs = store.getPrefs();
  const providers = await catalog.providers();
  if (prefs.providers.length === 0) return { mode: catalog.mode, channels: [], needsSetup: true };
  const pool = await catalog.pool(prefs.providers);

  const seedRows = store.marked("seed");
  const seedFilms: Film[] = [];
  const known = new Map(pool.map((f) => [f.id, f]));
  for (const row of [...seedRows].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, MAX_SEEDS_ENRICHED)) {
    const full = isFilm(row.film) ? row.film : (known.get(row.film.id) ?? (await catalog.film(row.film.id)));
    if (full) seedFilms.push(full);
  }

  const tastes = tastesOf(store);
  const seen = store.seenIds();
  for (const id of store.ids("seed")) seen.add(id);

  // Saved films come from the refreshed catalog cache, so a film that left your services drops out; the
  // stored snapshot is only the fallback when the catalog cannot answer.
  const savedFilms: Film[] = [];
  for (const snap of store.savedFilms()) savedFilms.push(known.get(snap.id) ?? (await catalog.film(snap.id)) ?? snap);

  const channels = buildChannels({
    pool,
    prefs,
    providers,
    seeds: seedFilms,
    tastes,
    seenIds: seen,
    dismissedIds: store.actionIds("dismiss"),
    savedIds: store.actionIds("save"),
    dislikedIds: store.ids("dislike"),
  }, savedFilms);
  return { mode: catalog.mode, channels, needsSetup: false };
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

export interface ImportReport {
  read: number;
  matched: number;
  seeds: number;
  skippedEpisodes?: number;
  unmatched: Array<{ title: string; year: number | null }>;
  truncated: boolean;
}

async function matchEntries(store: Store, catalog: Catalog, entries: Entry[], source: string, onMatch: (hit: SearchHit, e: Entry) => void): Promise<{ matched: number; unmatched: Array<{ title: string; year: number | null }> }> {
  let matched = 0;
  const unmatched: Array<{ title: string; year: number | null }> = [];
  store.clearUnmatched(source);
  await mapLimit(entries, 6, async (e) => {
    let hit: SearchHit | null = null;
    try {
      const results = await catalog.search(e.title, e.year);
      hit = pickMatch(e.title, e.year, results) as SearchHit | null;
    } catch {
      hit = null;
    }
    if (hit) { matched++; onMatch(hit, e); } else unmatched.push({ title: e.title, year: e.year });
  });
  for (const u of unmatched) store.addUnmatched(u.title, u.year, source);
  return { matched, unmatched };
}

export async function importLetterboxd(store: Store, catalog: Catalog, zip: Buffer): Promise<ImportReport> {
  const parsed = parseLetterboxdZip(zip);
  const entries = parsed.watched.slice(0, MAX_IMPORT);
  const seedKeys = new Set(parsed.seeds.map((s) => `${s.title}|${s.year}`));
  const importedSeeds = new Set(store.marked("seed").filter((r) => r.source === "letterboxd").map((r) => r.film.id));
  let seeds = 0;
  const r = await matchEntries(store, catalog, entries, "letterboxd", (hit, e) => {
    const taste = tasteFromHit(hit, e.rating);
    store.mark(taste, "seen", "letterboxd", e.rating);
    if (seedKeys.has(`${e.title}|${e.year}`)) { store.mark(taste, "seed", "letterboxd", e.rating ?? 4); seeds++; }
    // A film this import once made a seed, now rated lower or unliked, stops being one. Setup seeds stay.
    else if (importedSeeds.has(hit.id)) store.unmark(hit.id, "seed");
  });
  return { read: parsed.watched.length, matched: r.matched, seeds, unmatched: r.unmatched, truncated: parsed.watched.length > entries.length };
}

export async function importNetflix(store: Store, catalog: Catalog, csv: string): Promise<ImportReport> {
  const { titles, skippedEpisodes } = parseNetflix(csv);
  const entries: Entry[] = titles.slice(0, MAX_IMPORT).map((title) => ({ title, year: null, rating: null, liked: false }));
  const r = await matchEntries(store, catalog, entries, "netflix", (hit) => store.mark(tasteFromHit(hit, null), "seen", "netflix"));
  return { read: titles.length, matched: r.matched, seeds: 0, skippedEpisodes, unmatched: r.unmatched, truncated: titles.length > entries.length };
}

export const providerName = (providers: Provider[], id: number) => providers.find((p) => p.id === id)?.name ?? `Service ${id}`;

/** Local calendar day helpers, taken from the client so the TV's time zone is the one that counts. */
export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
