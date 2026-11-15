import { describe, expect, it } from "vitest";
import { FIXTURE_FILMS, FIXTURE_PROVIDERS } from "../src/catalog/fixture";
import { buildChannels, candidates, clusterAffinity, interleaveOutside, isOutside, scoreFilm, usualCluster, type RankInput } from "../src/core/rank";
import { QUALITY, type Film, type Taste } from "../src/core/types";

const film = (id: number, over: Partial<Film> = {}): Film => ({
  id, title: `Film ${id}`, year: 2000, runtime: 100, genres: ["Drama"], country: "US", originalLanguage: "en", providers: [8], trailerKey: null,
  backdrop: null, poster: null, line: "", voteCount: 1000, voteAverage: 7.5, popularity: 10 + id, keywords: [], recommendations: [], ...over,
});

const base = (pool: Film[], over: Partial<RankInput> = {}): RankInput => ({
  pool, prefs: { providers: [8], languages: ["en"], subtitles: true }, providers: FIXTURE_PROVIDERS, seeds: [], tastes: [],
  seenIds: new Set(), dismissedIds: new Set(), savedIds: new Set(), ...over,
});

describe("candidates", () => {
  it("keeps only films on a chosen service", () => {
    const pool = [film(1), film(2, { providers: [119] })];
    expect(candidates(base(pool)).map((f) => f.id)).toEqual([1, 2].filter((i) => i === 1));
  });

  it("drops seen, dismissed and saved films", () => {
    const pool = [film(1), film(2), film(3), film(4)];
    const out = candidates(base(pool, { seenIds: new Set([1]), dismissedIds: new Set([2]), savedIds: new Set([3]) }));
    expect(out.map((f) => f.id)).toEqual([4]);
  });

  it("applies the quality floor", () => {
    const pool = [film(1, { voteCount: QUALITY.minVotes - 1 }), film(2, { voteAverage: QUALITY.minAverage - 0.1 }), film(3, { voteCount: QUALITY.minVotes, voteAverage: QUALITY.minAverage })];
    expect(candidates(base(pool)).map((f) => f.id)).toEqual([3]);
  });

  it("drops the most popular decile of the candidate set", () => {
    const pool = Array.from({ length: 20 }, (_, i) => film(i + 1, { popularity: i + 1 }));
    const ids = candidates(base(pool)).map((f) => f.id);
    expect(ids).toHaveLength(18);
    expect(ids).not.toContain(20);
    expect(ids).not.toContain(19);
    expect(ids).toContain(18);
  });

  it("drops nothing from a set smaller than ten", () => {
    const pool = Array.from({ length: 9 }, (_, i) => film(i + 1, { popularity: i + 1 }));
    expect(candidates(base(pool))).toHaveLength(9);
  });

  it("filters other languages only when subtitles are off", () => {
    const pool = [film(1), film(2, { originalLanguage: "ja" })];
    expect(candidates(base(pool))).toHaveLength(2);
    expect(candidates(base(pool, { prefs: { providers: [8], languages: ["en"], subtitles: false } })).map((f) => f.id)).toEqual([1]);
  });

  it("never offers a disliked film", () => {
    expect(candidates(base([film(1), film(2)], { dislikedIds: new Set([2]) })).map((f) => f.id)).toEqual([1]);
  });
});

describe("usual cluster", () => {
  const tastes: Taste[] = [
    { id: 1, title: "a", year: 1994, genres: ["Crime"], country: "US", rating: 5 },
    { id: 2, title: "b", year: 1995, genres: ["Crime"], country: "US", rating: 4 },
    { id: 3, title: "c", year: 1999, genres: ["Drama"], country: "US", rating: 4 },
    { id: 4, title: "d", year: 1996, genres: ["Crime"], country: "GB", rating: 4 },
  ];
  const h = usualCluster(tastes);

  it("counts shares per axis", () => {
    expect(h.genre.get("Crime")).toBeCloseTo(0.75);
    expect(h.decade.get(1990)).toBe(1);
    expect(h.country.get("US")).toBeCloseTo(0.75);
  });

  it("scores a lookalike high and a stranger low", () => {
    expect(clusterAffinity(film(9, { genres: ["Crime"], year: 1997, country: "US" }), h)).toBeGreaterThan(0.7);
    const stranger = film(10, { genres: ["Animation"], year: 1954, country: "JP" });
    expect(clusterAffinity(stranger, h)).toBe(0);
    expect(isOutside(stranger, h)).toBe(true);
  });

  it("treats everything as outside when there is no history", () => {
    expect(isOutside(film(1), usualCluster([]))).toBe(true);
  });
});

describe("interleave", () => {
  it("takes every third slot from outside", () => {
    const inside = Array.from({ length: 6 }, (_, i) => ({ n: `i${i}`, outside: false }));
    const outside = Array.from({ length: 3 }, (_, i) => ({ n: `o${i}`, outside: true }));
    expect(interleaveOutside(inside, outside).map((x) => x.n)).toEqual(["i0", "i1", "o0", "i2", "i3", "o1", "i4", "i5", "o2"]);
  });

  it("falls back when one side runs out", () => {
    const inside = [{ n: "i0", outside: false }];
    const outside = [{ n: "o0", outside: true }, { n: "o1", outside: true }, { n: "o2", outside: true }];
    expect(interleaveOutside(inside, outside).map((x) => x.n)).toEqual(["i0", "o0", "o1", "o2"]);
  });
});

describe("scoring", () => {
  it("rewards recommendations from loved films and names the loved film", () => {
    const loved = film(100, { title: "Loved", recommendations: [1], keywords: ["x"], genres: ["Drama"] });
    const rec = scoreFilm(film(1, { keywords: ["x"] }), [loved]);
    const other = scoreFilm(film(2), [loved]);
    expect(rec.score).toBeGreaterThan(other.score);
    expect(rec.becauseOf?.title).toBe("Loved");
    expect(other.becauseOf).toBeNull();
  });
});

describe("channels on the sample catalog", () => {
  const seeds = FIXTURE_FILMS.filter((f) => ["Arrival", "Blade Runner", "Her"].includes(f.title));
  const input = (over: Partial<RankInput> = {}): RankInput => ({
    pool: FIXTURE_FILMS,
    prefs: { providers: FIXTURE_PROVIDERS.map((p) => p.id), languages: ["en", "es"], subtitles: true },
    providers: FIXTURE_PROVIDERS,
    seeds,
    tastes: seeds.map((f) => ({ id: f.id, title: f.title, year: f.year, genres: f.genres, country: f.country, rating: 5 })),
    seenIds: new Set(seeds.map((f) => f.id)),
    dismissedIds: new Set(),
    savedIds: new Set(),
    ...over,
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildChannels(input()))).toBe(JSON.stringify(buildChannels(input())));
    expect(JSON.stringify(buildChannels(input({ pool: [...FIXTURE_FILMS].reverse() })))).toBe(JSON.stringify(buildChannels(input())));
  });

  it("builds Tonight, Outside your usual and themed channels, with a why line on every pick", () => {
    const channels = buildChannels(input());
    expect(channels[0]?.name).toBe("Tonight");
    expect(channels.map((c) => c.name)).toContain("Outside your usual");
    const themed = channels.filter((c) => !["tonight", "outside", "saved"].includes(c.id));
    expect(themed.length).toBeGreaterThanOrEqual(3);
    expect(themed.length).toBeLessThanOrEqual(QUALITY.maxThemed);
    for (const c of channels) for (const p of c.picks) expect(p.why).toMatch(/ · .+ · /);
  });

  it("never shows a seen film", () => {
    const seen = new Set(seeds.map((f) => f.id));
    for (const c of buildChannels(input())) for (const p of c.picks) expect(seen.has(p.film.id)).toBe(false);
  });

  it("puts a stranger in every third Tonight slot", () => {
    const tonight = buildChannels(input()).find((c) => c.id === "tonight")!;
    tonight.picks.forEach((p, i) => {
      if ((i + 1) % QUALITY.outsideEvery === 0) expect(p.outside).toBe(true);
    });
  });

  it("says which loved film a pick comes from", () => {
    const tonight = buildChannels(input()).find((c) => c.id === "tonight")!;
    expect(tonight.picks.some((p) => p.why.startsWith("Because you loved "))).toBe(true);
  });

  it("returns nothing when no service is chosen", () => {
    expect(buildChannels(input({ prefs: { providers: [], languages: [], subtitles: true } }))).toEqual([]);
  });
});
