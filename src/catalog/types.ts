import type { Film, Provider } from "../core/types";
import type { Candidate } from "../core/match";

export interface SearchHit extends Candidate {
  genres: string[];
  country: string | null;
  poster: string | null;
}

/** What the app asks of a catalog. The TMDB client and the sample fixture both implement it. */
export interface Catalog {
  readonly mode: "tmdb" | "sample";
  /** Services in Spain, the default ones first. */
  providers(): Promise<Provider[]>;
  /** Films on a flat rate in Spain on any of these services, fully enriched. */
  pool(providerIds: number[]): Promise<Film[]>;
  film(id: number): Promise<Film | null>;
  search(query: string, year?: number | null): Promise<SearchHit[]>;
}
