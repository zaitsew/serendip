import type { Film, Provider } from "./types";

/**
 * Where "Watch on <service>" goes. Only services whose search URL format we know get their own search;
 * everything else opens the TMDB watch page for the film. Sample films have no real TMDB page, so they
 * open a TMDB search.
 */

const q = encodeURIComponent;

const SEARCH: Record<string, (title: string) => string> = {
  Netflix: (t) => `https://www.netflix.com/search?q=${q(t)}`,
  "Prime Video": (t) => `https://www.primevideo.com/search/?phrase=${q(t)}`,
  "Apple TV+": (t) => `https://tv.apple.com/es/search?term=${q(t)}`,
};

export function watchUrl(film: Pick<Film, "id" | "title" | "sample">, provider: Provider): string {
  const own = SEARCH[provider.name];
  if (own) return own(film.title);
  if (film.sample) return `https://www.themoviedb.org/search?query=${q(film.title)}`;
  return `https://www.themoviedb.org/movie/${film.id}/watch?locale=ES`;
}

/**
 * The trailer embed: youtube-nocookie, muted autoplay, looping. `start` seconds in, so it feels like
 * landing on a channel mid-film; the same film always starts at the same second.
 */
export function trailerEmbed(key: string, filmId = 0): string {
  const k = q(key);
  const start = 15 + (Math.abs(filmId) % 40);
  return `https://www.youtube-nocookie.com/embed/${k}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1&playlist=${k}&modestbranding=1&start=${start}`;
}
