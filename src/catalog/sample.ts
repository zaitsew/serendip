import type { Film, Provider } from "../core/types";
import type { Catalog, SearchHit } from "./types";
import { FIXTURE_FILMS, FIXTURE_PROVIDERS } from "./fixture";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The labelled sample catalog: same interface as TMDB, answers from the 32 fixture films. */
export function createSample(films: Film[] = FIXTURE_FILMS, providers: Provider[] = FIXTURE_PROVIDERS): Catalog {
  return {
    mode: "sample",
    async providers() {
      return providers;
    },
    async pool(ids) {
      const want = new Set(ids);
      return films.filter((f) => f.providers.some((p) => want.has(p)));
    },
    async film(id) {
      return films.find((f) => f.id === id) ?? null;
    },
    async search(query, year) {
      const q = norm(query.trim());
      if (!q) return [];
      return films
        .filter((f) => new RegExp(`(^|[^a-z0-9])${q.replace(/[^a-z0-9 ]/g, "")}`).test(norm(f.title)) && (year == null || f.year == null || Math.abs(f.year - year) <= 1))
        .map<SearchHit>((f) => ({ id: f.id, title: f.title, year: f.year, popularity: f.popularity, genres: f.genres, country: f.country, poster: null }))
        .slice(0, 10);
    },
  };
}
