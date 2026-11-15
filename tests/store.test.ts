import { describe, expect, it } from "vitest";
import { FIXTURE_FILMS } from "../src/catalog/fixture";
import { createSample } from "../src/catalog/sample";
import { buildFeed, importNetflix } from "../src/server/service";
import { openDb } from "../src/server/db";
import { createStore } from "../src/server/store";

const fresh = () => createStore(openDb(":memory:"));
const [a, b, c] = FIXTURE_FILMS as [(typeof FIXTURE_FILMS)[number], (typeof FIXTURE_FILMS)[number], (typeof FIXTURE_FILMS)[number]];

describe("store and usage probe", () => {
  it("starts at zero", () => {
    expect(fresh().usage()).toEqual({ seeds: 0, seen: 0, picks_shown: 0, opens: 0, saves: 0, dismissals: 0, evenings_logged: 0, last_open: "never" });
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

  it("a Seen or Not-for-me action removes a saved film from Saved", () => {
    const s = fresh();
    s.act(a, "save");
    s.act(a, "seen");
    expect(s.savedFilms()).toEqual([]);
    expect(s.seenIds().has(a.id)).toBe(true);
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
