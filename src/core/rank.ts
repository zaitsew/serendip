import { QUALITY, type Channel, type Film, type Pick, type Prefs, type Provider, type Taste } from "./types";
import { formatRuntime, countryPhrase, decadeLabel, whyLine } from "./why";

/**
 * Ranking. Pure and deterministic: the same input gives the same channels, in the same order.
 * No clock, no randomness, no network, no LLM. Ties break on film id.
 */

export interface RankInput {
  /** Every film we could show, enriched (genres, country, keywords, recommendations). */
  pool: Film[];
  prefs: Prefs;
  /** Services by id, to name the one a pick plays on. */
  providers: Provider[];
  /** Loved films (rating >= 4, liked, or typed in the setup). Hold full detail when known. */
  seeds: Film[];
  /** The usual cluster is counted over these (seeds plus everything seen). */
  tastes: Taste[];
  seenIds: ReadonlySet<number>;
  dismissedIds: ReadonlySet<number>;
  savedIds: ReadonlySet<number>;
  /** Ids the person disliked in the setup: they and nothing near them lead a channel. */
  dislikedIds?: ReadonlySet<number>;
}

export interface Histograms {
  genre: Map<string, number>;
  decade: Map<number, number>;
  country: Map<string, number>;
  total: number;
}

const decadeOf = (year: number | null): number | null => (year == null ? null : Math.floor(year / 10) * 10);

/** Share of each genre, decade and country across the tastes (each value 0..1, each map sums to ~1). */
export function usualCluster(tastes: Taste[]): Histograms {
  const genre = new Map<string, number>();
  const decade = new Map<number, number>();
  const country = new Map<string, number>();
  let g = 0;
  let d = 0;
  let c = 0;
  for (const t of tastes) {
    for (const name of t.genres) {
      genre.set(name, (genre.get(name) ?? 0) + 1);
      g += 1;
    }
    const dec = decadeOf(t.year);
    if (dec != null) {
      decade.set(dec, (decade.get(dec) ?? 0) + 1);
      d += 1;
    }
    if (t.country) {
      country.set(t.country, (country.get(t.country) ?? 0) + 1);
      c += 1;
    }
  }
  for (const [k, v] of genre) genre.set(k, v / g);
  for (const [k, v] of decade) decade.set(k, v / d);
  for (const [k, v] of country) country.set(k, v / c);
  return { genre, decade, country, total: tastes.length };
}

/** 0..1: how much a film looks like what the person usually watches (mean of the known axes). */
export function clusterAffinity(film: Film, h: Histograms): number {
  if (h.total === 0) return 0;
  const parts: number[] = [];
  parts.push(film.genres.reduce((m, name) => Math.max(m, h.genre.get(name) ?? 0), 0));
  const dec = decadeOf(film.year);
  if (dec != null) parts.push(h.decade.get(dec) ?? 0);
  if (film.country) parts.push(h.country.get(film.country) ?? 0);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export const isOutside = (film: Film, h: Histograms): boolean => clusterAffinity(film, h) < QUALITY.outsideBelow;

function matchingProvider(film: Film, chosen: ReadonlySet<number>, providers: Provider[]): Provider | null {
  const byId = new Map(providers.map((p) => [p.id, p]));
  for (const id of [...film.providers].sort((a, b) => a - b)) {
    if (chosen.has(id)) return byId.get(id) ?? { id, name: `Service ${id}` };
  }
  return null;
}

/** Everything that may be shown: on a chosen service, unseen, above the floor, not the most popular. */
export function candidates(input: RankInput): Film[] {
  const chosen = new Set(input.prefs.providers);
  const langs = new Set(input.prefs.languages);
  const pass = input.pool.filter((f) => {
    if (!f.providers.some((p) => chosen.has(p))) return false;
    if (input.seenIds.has(f.id) || input.dismissedIds.has(f.id) || input.savedIds.has(f.id)) return false;
    if (input.dislikedIds?.has(f.id)) return false;
    if (f.voteCount < QUALITY.minVotes || f.voteAverage < QUALITY.minAverage) return false;
    if (!input.prefs.subtitles && langs.size > 0 && f.originalLanguage && !langs.has(f.originalLanguage)) return false;
    return true;
  });
  // Drop the top decile by popularity, measured inside this set.
  const drop = Math.floor(pass.length * QUALITY.popularDecile);
  if (drop === 0) return pass;
  const cut = new Set([...pass].sort((a, b) => b.popularity - a.popularity || a.id - b.id).slice(0, drop).map((f) => f.id));
  return pass.filter((f) => !cut.has(f.id));
}

interface Scored {
  film: Film;
  score: number;
  /** The loved film that recommends this one most strongly, when any does. */
  becauseOf: Film | null;
}

/** Score = recommendations of loved films + keyword and genre overlap + a small quality term. */
export function scoreFilm(film: Film, seeds: Film[], seedWeight: (s: Film) => number = () => 1): Scored {
  let score = 0;
  let becauseOf: Film | null = null;
  let best = 0;
  const kw = new Set(film.keywords);
  const genres = new Set(film.genres);
  for (const seed of seeds) {
    const w = seedWeight(seed);
    // A link is a recommendation either way or a shared keyword. Genre alone scores but is no reason to name a film.
    let link = 0;
    if (seed.recommendations.includes(film.id)) link += 3 * w;
    if (film.recommendations.includes(seed.id)) link += 1.5 * w;
    link += 0.5 * w * seed.keywords.filter((k) => kw.has(k)).length;
    score += link + 0.25 * w * seed.genres.filter((g) => genres.has(g)).length;
    if (link > best || (link === best && link > 0 && becauseOf && seed.id < becauseOf.id)) {
      best = link;
      becauseOf = link > 0 ? seed : null;
    }
  }
  // Quality nudges, never decides: 0 at the floor, about 0.6 at 8.7.
  score += (film.voteAverage - QUALITY.minAverage) * 0.3;
  return { film, score, becauseOf };
}

const byScore = (a: Scored, b: Scored) => b.score - a.score || a.film.id - b.film.id;

function toPick(s: Scored, input: RankInput, h: Histograms, chosen: ReadonlySet<number>, seedsById: Map<number, Film>): Pick {
  const provider = matchingProvider(s.film, chosen, input.providers) ?? { id: 0, name: "?" };
  const outside = isOutside(s.film, h);
  const because = s.becauseOf ? (seedsById.get(s.becauseOf.id) ?? s.becauseOf) : null;
  return {
    film: s.film,
    score: Math.round(s.score * 100) / 100,
    outside,
    provider,
    why: whyLine({ film: s.film, because, outside, provider, hist: h }),
  };
}

/** Tonight: ranked by taste, with every third slot taken from outside the usual cluster. */
export function interleaveOutside<T extends { outside: boolean }>(inside: T[], outside: T[], every: number = QUALITY.outsideEvery): T[] {
  const out: T[] = [];
  let i = 0;
  let o = 0;
  while (i < inside.length || o < outside.length) {
    const slot = out.length + 1;
    const wantOutside = slot % every === 0;
    if (wantOutside && o < outside.length) out.push(outside[o++]!);
    else if (i < inside.length) out.push(inside[i++]!);
    else if (o < outside.length) out.push(outside[o++]!);
  }
  return out;
}

function rarity(h: Histograms, film: Film): number {
  return 1 - clusterAffinity(film, h);
}

export interface ThemedSpec {
  id: string;
  name: string;
  blurb: string;
  test: (f: Film) => boolean;
  /** How many candidates match, for ordering. */
  size: number;
}

/** Data-built themes: a country, a decade and a rarely watched genre. At most `maxThemed`. */
export function themedSpecs(cands: Film[], h: Histograms): ThemedSpec[] {
  const specs: ThemedSpec[] = [];
  const MIN = 3;

  // Countries: the ones the person watches least, among those with enough films.
  const byCountry = new Map<string, number>();
  for (const f of cands) if (f.country) byCountry.set(f.country, (byCountry.get(f.country) ?? 0) + 1);
  const countries = [...byCountry.entries()]
    .filter(([, n]) => n >= MIN)
    .sort((a, b) => (h.country.get(a[0]) ?? 0) - (h.country.get(b[0]) ?? 0) || b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [code, n] of countries.slice(0, 2)) {
    specs.push({ id: `country-${code.toLowerCase()}`, name: `Cinema from ${countryPhrase(code)}`, blurb: `${n} films from ${countryPhrase(code)} on your services.`, test: (f) => f.country === code, size: n });
  }

  // Decade: the one the person watches least that still has films.
  const byDecade = new Map<number, number>();
  for (const f of cands) {
    const d = decadeOf(f.year);
    if (d != null) byDecade.set(d, (byDecade.get(d) ?? 0) + 1);
  }
  const decades = [...byDecade.entries()]
    .filter(([, n]) => n >= MIN)
    .sort((a, b) => (h.decade.get(a[0]) ?? 0) - (h.decade.get(b[0]) ?? 0) || b[1] - a[1] || a[0] - b[0]);
  const dec = decades[0];
  if (dec) specs.push({ id: `decade-${dec[0]}`, name: `The ${decadeLabel(dec[0])}`, blurb: `Films from the ${decadeLabel(dec[0])}, a decade you rarely pick.`, test: (f) => decadeOf(f.year) === dec[0], size: dec[1] });

  // Genres you rarely watch.
  const byGenre = new Map<string, number>();
  for (const f of cands) for (const g of f.genres) byGenre.set(g, (byGenre.get(g) ?? 0) + 1);
  const genres = [...byGenre.entries()]
    .filter(([, n]) => n >= MIN)
    .sort((a, b) => (h.genre.get(a[0]) ?? 0) - (h.genre.get(b[0]) ?? 0) || b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [g, n] of genres.slice(0, 2)) {
    specs.push({ id: `genre-${g.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: `Rarely yours: ${g}`, blurb: `${g}, a genre you seldom watch.`, test: (f) => f.genres.includes(g), size: n });
  }

  return specs.slice(0, QUALITY.maxThemed);
}

/** Builds every channel, in dial order: Tonight, Outside your usual, themed channels, Saved. */
export function buildChannels(input: RankInput, savedFilms: Film[] = []): Channel[] {
  const cands = candidates(input);
  const h = usualCluster(input.tastes);
  const chosen = new Set(input.prefs.providers);
  const seedsById = new Map(input.seeds.map((s) => [s.id, s]));
  const scored = cands.map((f) => scoreFilm(f, input.seeds)).sort(byScore);
  const make = (s: Scored) => toPick(s, input, h, chosen, seedsById);
  const size = QUALITY.channelSize;

  const insideS = scored.filter((s) => !isOutside(s.film, h));
  const outsideS = scored.filter((s) => isOutside(s.film, h));
  const tonight = interleaveOutside(insideS.map(make), outsideS.map(make)).slice(0, size);

  // Outside your usual: furthest from the cluster first, quality breaks ties.
  const outsideRanked = [...outsideS].sort((a, b) => rarity(h, b.film) - rarity(h, a.film) || b.film.voteAverage - a.film.voteAverage || a.film.id - b.film.id);
  const channels: Channel[] = [];
  if (tonight.length) channels.push({ id: "tonight", name: "Tonight", blurb: "Your taste first, with a stranger every third film.", picks: tonight });
  if (outsideRanked.length) channels.push({ id: "outside", name: "Outside your usual", blurb: "Films far from what you usually watch.", picks: outsideRanked.slice(0, size).map(make) });

  for (const spec of themedSpecs(cands, h)) {
    const picks = scored.filter((s) => spec.test(s.film)).slice(0, size).map(make);
    if (picks.length) channels.push({ id: spec.id, name: spec.name, blurb: spec.blurb, picks });
  }

  const saved = savedFilms.filter((f) => f.providers.some((p) => chosen.has(p)));
  if (saved.length) {
    const picks = saved.map((f) => {
      const s = scoreFilm(f, input.seeds);
      return toPick({ ...s, becauseOf: null }, input, h, chosen, seedsById);
    });
    channels.push({ id: "saved", name: "Saved", blurb: "Films you kept for later.", picks: picks.map((p) => ({ ...p, why: `Saved by you · ${p.provider.name} · ${formatRuntime(p.film.runtime)}` })) });
  }
  return channels;
}
