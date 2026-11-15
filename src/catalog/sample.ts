import type { Film, Provider } from "../core/types";
import type { Catalog, SearchHit } from "./types";
import { FIXTURE_FILMS, FIXTURE_PROVIDERS } from "./fixture";

/** Accents, case, "&" and punctuation all fold away on both sides: "Pan's Labyrinth" finds "Pans Labyrinth". */
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
      const q = norm(query);
      if (!q) return [];
      return films
        .filter((f) => ` ${norm(f.title)}`.includes(` ${q}`) && (year == null || f.year == null || Math.abs(f.year - year) <= 1))
        .map<SearchHit>((f) => ({ id: f.id, title: f.title, year: f.year, popularity: f.popularity, genres: f.genres, country: f.country, poster: null }))
        .slice(0, 10);
    },
  };
}
