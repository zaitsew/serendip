/** The shared shapes. Pure data: nothing in src/core touches the network, the disk or the clock. */

export interface Film {
  /** TMDB id. Fixture films use ids from 9_000_001 up so they never clash with real ones. */
  id: number;
  title: string;
  year: number | null;
  runtime: number | null; // minutes
  genres: string[];
  /** ISO 3166-1 code of the first production country, when known. */
  country: string | null;
  originalLanguage: string | null;
  /** Ids of the services that stream it on a flat rate in Spain. */
  providers: number[];
  trailerKey: string | null; // YouTube video key
  backdrop: string | null; // full image URL
  poster: string | null; // full image URL
  /** One line in our own words (fixture) or the TMDB tagline (live). Never a copied overview. */
  line: string;
  voteCount: number;
  voteAverage: number;
  popularity: number;
  keywords: string[];
  /** TMDB recommendation ids for this film. */
  recommendations: number[];
  /** True for the labelled sample catalog. */
  sample?: boolean;
}

export interface Provider {
  id: number;
  name: string;
}

export interface Prefs {
  /** Chosen service ids in Spain. */
  providers: number[];
  /** Language codes (ISO 639-1) the person is happy to watch in. */
  languages: string[];
  /** When true, films in other languages stay in (subtitles). */
  subtitles: boolean;
}

/** A film the person has told us about, with just enough to build the usual cluster. */
export interface Taste {
  id: number;
  title: string;
  year: number | null;
  genres: string[];
  country: string | null;
  /** Rating 0.5..5 when known. */
  rating: number | null;
}

export interface Pick {
  film: Film;
  score: number;
  /** One line from a template: "Because you loved Arrival · Filmin · 1 h 56". */
  why: string;
  outside: boolean;
  /** The service this pick plays on. */
  provider: Provider;
}

export interface Channel {
  id: string;
  name: string;
  blurb: string;
  picks: Pick[];
}

export const QUALITY = {
  /** Candidate floor. Tunable. */
  minVotes: 200,
  minAverage: 6.8,
  /** Share of the candidate set, by popularity, that is dropped. */
  popularDecile: 0.1,
  /** A film is outside the usual cluster below this affinity. */
  outsideBelow: 0.15,
  /** In Tonight, every Nth slot comes from outside the cluster. */
  outsideEvery: 3,
  channelSize: 12,
  maxThemed: 5,
} as const;
