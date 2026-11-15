import { describe, expect, it } from "vitest";
import { quotaDay } from "../src/core/detour";
import { FIXTURE_FILMS } from "../src/catalog/fixture";
import { createSample } from "../src/catalog/sample";
import { buildFeed, importNetflix, tastesOf } from "../src/server/service";
import { openDb } from "../src/server/db";
import { createStore } from "../src/server/store";

const fresh = () => createStore(openDb(":memory:"));
const [a, b, c] = FIXTURE_FILMS as [(typeof FIXTURE_FILMS)[number], (typeof FIXTURE_FILMS)[number], (typeof FIXTURE_FILMS)[number]];

describe("store and usage probe", () => {
  it("starts at zero", () => {
    expect(fresh().usage()).toEqual({
      seeds: 0, seen: 0, picks_shown: 0, opens: 0, saves: 0, dismissals: 0, evenings_logged: 0, last_open: "never",
      takeout_videos: 0, detour_fields: 0, detour_picks_shown: 0, detour_watches: 0, detour_dismissals: 0, search_calls_today: 0, youtube_connected: 0,
    });
  });

  it("counts seeds, seen, picks, opens, saves, dismissals and evenings", () => {
    const s = fresh();
    s.mark(a, "seed", "setup", 5);
    s.mark(b, "seen", "netflix");
    s.act(c, "save");
    s.act(a, "dismiss");
    s.event("open"); s.event("open"); s.event("pick_shown", a.id);
    s.logEvening({ day: "2026-11-14", watched: "Roma", source: "netflix", enjoyment: 4, minutesToChoose: 30 });
    const u = s.usage();
    expect(u).toMatchObject({ seeds: 1, seen: 2, picks_shown: 1, opens: 2, saves: 1, dismissals: 1, evenings_logged: 1 });
    expect(String(u.last_open)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("counts the Detour lane in the usage probe", () => {
    const s = fresh();
    s.yt.replaceWatched([{ videoId: "aaaaaaaaaaa", title: "t", channel: "c", channelId: null, lastAt: 1, plays: 2 }]);
    s.yt.setFields(["physics", "jazz"]);
    s.event("detour_shown", null, { videoId: "aaaaaaaaaaa" });
    s.event("detour_shown", null, { videoId: "bbbbbbbbbbb" });
    s.event("detour_watch", null, { videoId: "aaaaaaaaaaa" });
    s.yt.detourAct({ videoId: "aaaaaaaaaaa", action: "dismiss", field: "physics", channelId: "UC1", channelTitle: "c", title: "t" });
    s.yt.setSealedToken("sealed");
    s.yt.addUsage(quotaDay(Date.now()), 3, 300);
    expect(s.usage()).toMatchObject({ takeout_videos: 1, detour_fields: 2, detour_picks_shown: 2, detour_watches: 1, detour_dismissals: 1, search_calls_today: 3, youtube_connected: 1 });
  });

  it("a Seen or Not-for-me action removes a saved film from Saved", () => {
    const s = fresh();
    s.act(a, "save");
    s.act(a, "seen");
    expect(s.savedFilms()).toEqual([]);
    expect(s.seenIds().has(a.id)).toBe(true);
  });

  it("never downgrades a stored Film to a Taste, so Saved still renders after an import", async () => {
    const s = fresh();
    s.act(a, "save");
    s.mark({ id: a.id, title: a.title, year: a.year, genres: a.genres, country: a.country, rating: 4 }, "seen", "letterboxd", 4);
    expect(s.savedFilms()[0]?.providers).toEqual(a.providers);
    const prefs = { providers: a.providers, languages: ["en"], subtitles: true };
    s.setPrefs(prefs);
    const feed = await buildFeed(s, createSample());
    expect(feed.channels.some((ch) => ch.id === "saved")).toBe(true);
  });

  it("counts films marked Already seen in the taste histogram", () => {
    const s = fresh();
    s.act(b, "seen");
    s.act(c, "dismiss");
    expect(tastesOf(s).map((t) => t.id)).toEqual([b.id]);
  });

  it("builds Saved from the refreshed catalog, not the stored snapshot", async () => {
    const s = fresh();
    s.act({ ...a, providers: [a.providers[0]!] }, "save"); // an old snapshot
    s.setPrefs({ providers: a.providers, languages: ["en"], subtitles: true });
    const stale = { ...a, providers: [999_999] };
    const cat = { ...createSample(), async film(id: number) { return id === a.id ? stale : null; }, async pool() { return []; } };
    const feed = await buildFeed(s, cat);
    expect(feed.channels.some((ch) => ch.id === "saved")).toBe(false); // the cache says it left the chosen services
  });

  it("asks about yesterday once: not when logged, not when dismissed", () => {
    const s = fresh();
    expect(s.hasEvening("2026-11-14")).toBe(false);
    s.dismissPrompt("2026-11-14");
    expect(s.dismissedPrompt("2026-11-14")).toBe(true);
    s.logEvening({ day: "2026-11-13", watched: "x", source: "zapping", enjoyment: null, minutesToChoose: null });
    expect(s.hasEvening("2026-11-13")).toBe(true);
  });
});

describe("feed and imports on the sample catalog", () => {
  it("asks for setup before any service is chosen", async () => {
    expect((await buildFeed(fresh(), createSample())).needsSetup).toBe(true);
  });

  it("builds channels and hides what you marked seen or dismissed", async () => {
    const s = fresh();
    const cat = createSample();
    s.setPrefs({ providers: (await cat.providers()).map((p) => p.id), languages: ["en"], subtitles: true });
    s.mark(a, "seed", "setup", 5);
    s.act(b, "dismiss");
    const feed = await buildFeed(s, cat);
    const ids = feed.channels.flatMap((ch) => ch.picks.map((p) => p.film.id));
    expect(ids.length).toBeGreaterThan(5);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it("imports a Netflix CSV: matched titles are seen, the rest is listed", async () => {
    const s = fresh();
    const r = await importNetflix(s, createSample(), `Title,Date\nArrival,2020-01-01\nSome Show: Season 1: Pilot,2020-01-02\nNo Such Film,2020-01-03\n`);
    expect(r).toMatchObject({ read: 2, matched: 1, skippedEpisodes: 1 });
    expect(r.unmatched).toEqual([{ title: "No Such Film", year: null }]);
    expect(s.seenIds().size).toBe(1);
    expect(s.unmatched()).toHaveLength(1);
  });
});
