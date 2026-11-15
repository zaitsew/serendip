import type { DatabaseSync } from "node:sqlite";
import type { Film, Provider } from "../core/types";
import type { Catalog, SearchHit } from "./types";
import { QUALITY } from "../core/types";

/**
 * The TMDB client (v3 API, v4 read token). Every response is cached in SQLite for 24 hours.
 * Availability data comes from JustWatch through TMDB and needs the attribution in the footer.
 * Nothing is scraped: only the documented API is called.
 */

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REGION = "ES";

/** The default list, matched by name against TMDB's Spanish provider list. */
export const DEFAULT_SERVICE_NAMES = ["Netflix", "Amazon Prime Video", "Disney Plus", "Movistar Plus+", "Filmin", "Max", "HBO Max", "Apple TV Plus", "Apple TV+", "SkyShowtime"];
const DISPLAY_NAME: Record<string, string> = { "Amazon Prime Video": "Prime Video", "Disney Plus": "Disney+", "Apple TV Plus": "Apple TV+", "HBO Max": "Max" };

type Json = Record<string, unknown>;

export interface TmdbOptions {
  token: string;
  db: DatabaseSync;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Detail {
  id: number;
  title: string;
  release_date?: string;
  runtime?: number | null;
  genres?: Array<{ id: number; name: string }>;
  production_countries?: Array<{ iso_3166_1: string }>;
  origin_country?: string[];
  original_language?: string;
  tagline?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_count?: number;
  vote_average?: number;
  popularity?: number;
  videos?: { results?: Array<{ site: string; type: string; key: string; official?: boolean }> };
  "watch/providers"?: { results?: Record<string, { flatrate?: Array<{ provider_id: number }> }> };
  keywords?: { keywords?: Array<{ name: string }> };
  recommendations?: { results?: Array<{ id: number }> };
}

const yearOf = (d?: string): number | null => {
  const y = Number.parseInt((d ?? "").slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
};

export function trailerKey(videos: Detail["videos"]): string | null {
  const list = (videos?.results ?? []).filter((v) => v.site === "YouTube" && /^[\w-]{6,20}$/.test(v.key));
  const best = list.find((v) => v.type === "Trailer" && v.official) ?? list.find((v) => v.type === "Trailer") ?? list.find((v) => v.type === "Teaser");
  return best?.key ?? null;
}

/** TMDB detail JSON to our Film. The one-liner is the tagline or a plain fact line, never the overview. */
export function filmFromDetail(d: Detail): Film {
  const genres = (d.genres ?? []).map((g) => g.name);
  const country = d.production_countries?.[0]?.iso_3166_1 ?? d.origin_country?.[0] ?? null;
  const year = yearOf(d.release_date);
  const tagline = d.tagline?.trim();
  return {
    id: d.id,
    title: d.title,
    year,
    runtime: d.runtime || null,
    genres,
    country,
    originalLanguage: d.original_language ?? null,
    providers: (d["watch/providers"]?.results?.[REGION]?.flatrate ?? []).map((p) => p.provider_id),
    trailerKey: trailerKey(d.videos),
    backdrop: d.backdrop_path ? `${IMG}/w1280${d.backdrop_path}` : null,
    poster: d.poster_path ? `${IMG}/w500${d.poster_path}` : null,
    line: tagline || [genres[0], year].filter(Boolean).join(", "),
    voteCount: d.vote_count ?? 0,
    voteAverage: d.vote_average ?? 0,
    popularity: d.popularity ?? 0,
    keywords: (d.keywords?.keywords ?? []).map((k) => k.name),
    recommendations: (d.recommendations?.results ?? []).map((r) => r.id),
  };
}

export function createTmdb(opts: TmdbOptions): Catalog & { cacheHits: number; calls: number } {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const state = { cacheHits: 0, calls: 0 };
  let genreNames: Map<number, string> | null = null;

  async function get<T = Json>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]).sort((x, y) => x[0].localeCompare(y[0])));
    const key = `${path}?${qs}`;
    const row = opts.db.prepare("SELECT body, fetched_at AS at FROM cache WHERE key = ?").get(key) as { body: string; at: number } | undefined;
    if (row && now() - row.at < CACHE_TTL_MS) {
      state.cacheHits++;
      return JSON.parse(row.body) as T;
    }
    state.calls++;
    const res = await doFetch(`${BASE}${path}${qs.size ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" } });
    if (!res.ok) {
      if (row) return JSON.parse(row.body) as T; // stale beats nothing
      throw new Error(`TMDB ${res.status} on ${path}${res.status === 401 ? " (check TMDB_READ_TOKEN)" : ""}`);
    }
    const body = await res.text();
    opts.db.prepare("INSERT INTO cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at").run(key, body, now());
    return JSON.parse(body) as T;
  }

  async function genres(): Promise<Map<number, string>> {
    if (genreNames) return genreNames;
    const r = await get<{ genres: Array<{ id: number; name: string }> }>("/genre/movie/list", { language: "en-US" });
    return (genreNames = new Map(r.genres.map((g) => [g.id, g.name])));
  }

  async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n]!);
      }
    }));
    return out;
  }

  const catalog = {
    mode: "tmdb" as const,
    get cacheHits() { return state.cacheHits; },
    get calls() { return state.calls; },

    async providers(): Promise<Provider[]> {
      const r = await get<{ results: Array<{ provider_id: number; provider_name: string; display_priority?: number }> }>("/watch/providers/movie", { watch_region: REGION, language: "en-US" });
      const all = r.results.map((p) => ({ id: p.provider_id, name: DISPLAY_NAME[p.provider_name] ?? p.provider_name, raw: p.provider_name, prio: p.display_priority ?? 999 }));
      const wanted = new Set(DEFAULT_SERVICE_NAMES);
      const defaults = all.filter((p) => wanted.has(p.raw));
      const rest = all.filter((p) => !wanted.has(p.raw)).sort((a, b) => a.prio - b.prio || a.name.localeCompare(b.name));
      // Order the defaults as listed, one entry per display name.
      const seen = new Set<string>();
      const ordered = DEFAULT_SERVICE_NAMES.flatMap((n) => defaults.filter((p) => p.raw === n)).filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
      return [...ordered, ...rest].map(({ id, name }) => ({ id, name }));
    },

    async film(id: number): Promise<Film | null> {
      try {
        const d = await get<Detail>(`/movie/${id}`, { append_to_response: "videos,watch/providers,keywords,recommendations", language: "en-US", include_video_language: "en,null" });
        return filmFromDetail(d);
      } catch {
        return null;
      }
    },

    async search(query: string, year?: number | null): Promise<SearchHit[]> {
      const g = await genres();
      const r = await get<{ results: Array<Json & { id: number; title: string; original_title?: string; release_date?: string; popularity?: number; genre_ids?: number[]; poster_path?: string | null }> }>(
        "/search/movie", { query, language: "en-US", include_adult: "false", ...(year ? { year } : {}) });
      return r.results.slice(0, 10).map((m) => ({
        id: m.id,
        title: m.title,
        originalTitle: m.original_title,
        year: yearOf(m.release_date),
        popularity: m.popularity,
        genres: (m.genre_ids ?? []).map((i) => g.get(i)).filter((x): x is string => !!x),
        country: null,
        poster: m.poster_path ? `${IMG}/w185${m.poster_path}` : null,
      }));
    },

    /** Discover on the chosen services: two general pages plus one page per decade, then full details. */
    async pool(providerIds: number[]): Promise<Film[]> {
      if (providerIds.length === 0) return [];
      const base = {
        watch_region: REGION,
        with_watch_monetization_types: "flatrate",
        with_watch_providers: [...providerIds].sort((a, b) => a - b).join("|"),
        "vote_count.gte": QUALITY.minVotes,
        "vote_average.gte": QUALITY.minAverage,
        include_adult: "false",
        language: "en-US",
      };
      const queries: Array<Record<string, string | number>> = [
        { ...base, sort_by: "vote_average.desc", page: 1 },
        { ...base, sort_by: "vote_average.desc", page: 2 },
        { ...base, sort_by: "popularity.desc", page: 1 },
      ];
      for (let dec = 1950; dec <= 2020; dec += 10) {
        queries.push({ ...base, sort_by: "vote_average.desc", "primary_release_date.gte": `${dec}-01-01`, "primary_release_date.lte": `${dec + 9}-12-31`, page: 1 });
      }
      const pages = await mapLimit(queries, 4, (q) => get<{ results: Array<{ id: number }> }>("/discover/movie", q));
      const ids = [...new Set(pages.flatMap((p) => p.results.map((m) => m.id)))].sort((a, b) => a - b);
      const films = await mapLimit(ids, 8, (id) => catalog.film(id));
      return films.filter((f): f is Film => !!f);
    },
  };
  return catalog;
}
