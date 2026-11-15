import { describe, expect, it } from "vitest";
import { createTmdb, filmFromDetail, trailerKey, CACHE_TTL_MS } from "../src/catalog/tmdb";
import { openDb } from "../src/server/db";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("tmdb client", () => {
  it("caches responses for 24 hours and refetches after", async () => {
    let t = 1_000_000;
    let calls = 0;
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      expect(String(url)).toContain("/search/movie");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      return String(url).includes("genre") ? json({ genres: [] }) : json({ results: [{ id: 1, title: "Arrival", release_date: "2016-11-10", popularity: 5, genre_ids: [18] }] });
    }) as typeof fetch;
    const c = createTmdb({ token: "tok", db: openDb(":memory:"), fetch: ((u: string, i?: RequestInit) => (String(u).includes("/genre/") ? Promise.resolve(json({ genres: [{ id: 18, name: "Drama" }] })) : fetchStub(u, i))) as typeof fetch, now: () => t });
    const a = await c.search("Arrival");
    expect(a[0]).toMatchObject({ id: 1, title: "Arrival", year: 2016, genres: ["Drama"] });
    const before = calls;
    await c.search("Arrival");
    expect(calls).toBe(before); // served from the cache
    t += CACHE_TTL_MS + 1;
    await c.search("Arrival");
    expect(calls).toBe(before + 1);
  });

  it("serves a stale entry when TMDB fails, and errors when there is none", async () => {
    let t = 0;
    let fail = false;
    const f = (async () => (fail ? new Response("no", { status: 500 }) : json({ genres: [{ id: 1, name: "X" }], results: [] }))) as typeof fetch;
    const c = createTmdb({ token: "tok", db: openDb(":memory:"), fetch: f, now: () => t });
    await c.search("x");
    fail = true;
    t += CACHE_TTL_MS + 5;
    await expect(c.search("x")).resolves.toEqual([]);
    await expect(c.search("never seen before")).rejects.toThrow(/TMDB 500/);
  });

  it("resolves the default services from the Spanish provider list", async () => {
    const f = (async () => json({ results: [
      { provider_id: 8, provider_name: "Netflix", display_priority: 1 },
      { provider_id: 119, provider_name: "Amazon Prime Video", display_priority: 2 },
      { provider_id: 63, provider_name: "Filmin", display_priority: 30 },
      { provider_id: 11, provider_name: "MUBI", display_priority: 9 },
    ] })) as typeof fetch;
    const names = (await createTmdb({ token: "t", db: openDb(":memory:"), fetch: f }).providers()).map((p) => p.name);
    expect(names).toEqual(["Netflix", "Prime Video", "Filmin", "MUBI"]);
  });

  it("builds a pool from discover then details, with the Spain flat-rate filter in the query", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(String(u));
      if (String(u).includes("/discover/movie")) return json({ results: [{ id: 7 }, { id: 8 }] });
      const id = Number(/\/movie\/(\d+)/.exec(String(u))?.[1]);
      return json({ id, title: `T${id}`, release_date: "1999-01-01", vote_count: 500, vote_average: 7.5, "watch/providers": { results: { ES: { flatrate: [{ provider_id: 8 }] } } } });
    }) as unknown as typeof fetch;
    const pool = await createTmdb({ token: "t", db: openDb(":memory:"), fetch: f }).pool([8, 119]);
    expect(pool.map((x) => x.id)).toEqual([7, 8]);
    const discover = urls.find((u) => u.includes("/discover/movie"))!;
    expect(discover).toContain("watch_region=ES");
    expect(discover).toContain("with_watch_monetization_types=flatrate");
    expect(discover).toContain("with_watch_providers=8%7C119");
  });
});

describe("film mapping", () => {
  it("prefers an official YouTube trailer", () => {
    expect(trailerKey({ results: [
      { site: "Vimeo", type: "Trailer", key: "vimeo123456" },
      { site: "YouTube", type: "Teaser", key: "teaser12345" },
      { site: "YouTube", type: "Trailer", key: "trailer1234" },
      { site: "YouTube", type: "Trailer", key: "official123", official: true },
    ] })).toBe("official123");
    expect(trailerKey({ results: [] })).toBeNull();
    expect(trailerKey({ results: [{ site: "YouTube", type: "Trailer", key: "bad key<script>" }] })).toBeNull();
  });

  it("maps a detail response and never copies the overview", () => {
    const f = filmFromDetail({
      id: 5, title: "X", release_date: "1988-11-17", runtime: 155, genres: [{ id: 18, name: "Drama" }], production_countries: [{ iso_3166_1: "IT" }],
      original_language: "it", backdrop_path: "/b.jpg", poster_path: "/p.jpg", vote_count: 10, vote_average: 8, popularity: 3,
      keywords: { keywords: [{ name: "cinema" }] }, recommendations: { results: [{ id: 9 }] },
      overview: "A long copyrighted overview.",
    } as never);
    expect(f).toMatchObject({ id: 5, year: 1988, runtime: 155, country: "IT", genres: ["Drama"], keywords: ["cinema"], recommendations: [9], line: "Drama, 1988" });
    expect(f.backdrop).toBe("https://image.tmdb.org/t/p/w1280/b.jpg");
    expect(JSON.stringify(f)).not.toContain("copyrighted");
  });
});
