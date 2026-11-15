import { describe, expect, it } from "vitest";
import { importTakeout } from "../src/server/detour";
import { openDb } from "../src/server/db";
import { createStore } from "../src/server/store";
import { dedupeWatched, parseTakeout, TakeoutError, videoIdFromUrl } from "../src/core/takeout";

const watch = (id: string, over: Record<string, unknown> = {}) => ({
  header: "YouTube",
  title: `Watched Video ${id}`,
  titleUrl: `https://www.youtube.com/watch?v=${id}`,
  subtitles: [{ name: "Some Channel", url: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" }],
  time: "2026-11-01T10:00:00.000Z",
  products: ["YouTube"],
  ...over,
});

describe("Takeout parser", () => {
  it("reads title, video id, channel and time", () => {
    const r = parseTakeout(JSON.stringify([watch("aaaaaaaaaaa")]));
    expect(r.entries).toEqual([{ videoId: "aaaaaaaaaaa", title: "Video aaaaaaaaaaa", channel: "Some Channel", channelId: "UCabcdefghijklmnopqrstuv", at: Date.parse("2026-11-01T10:00:00.000Z") }]);
  });

  it("ignores ads, YouTube Music, removed videos and non-watch rows, and counts each", () => {
    const rows = [
      watch("aaaaaaaaaaa"),
      watch("bbbbbbbbbbb", { details: [{ name: "From Google Ads" }] }),
      watch("ccccccccccc", { header: "YouTube Music", products: ["YouTube"] }),
      watch("ddddddddddd", { products: ["YouTube Music"] }),
      { header: "YouTube", title: "Watched a video that has been removed", products: ["YouTube"], time: "2026-11-01T10:00:00.000Z" },
      { header: "YouTube", title: "Searched for physics", titleUrl: "https://www.youtube.com/results?search_query=physics", time: "2026-11-01T10:00:00.000Z" },
      "junk",
    ];
    const r = parseTakeout(JSON.stringify(rows));
    expect(r.entries.map((e) => e.videoId)).toEqual(["aaaaaaaaaaa"]);
    expect(r.rows).toBe(7);
    expect(r.skipped).toEqual({ ads: 1, music: 2, removed: 1, other: 2 });
  });

  it("tells the user when they uploaded the HTML export", () => {
    for (const html of ["<!DOCTYPE html><html><body>x</body></html>", "  <html lang=en><head></head>"]) {
      expect(() => parseTakeout(html)).toThrowError(TakeoutError);
      try { parseTakeout(html); } catch (e) { expect((e as TakeoutError).code).toBe("html"); expect((e as Error).message).toMatch(/JSON/); }
    }
  });

  it("rejects empty files, broken JSON and JSON that is not a list", () => {
    expect(() => parseTakeout("  ")).toThrowError(/empty/);
    expect(() => parseTakeout("[{")).toThrowError(/not valid JSON/);
    expect(() => parseTakeout("{}")).toThrowError(/list/);
  });

  it("takes ids from watch, youtu.be and shorts links only when they are 11 valid characters", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("dQw4w9WgXcQ");
    expect(videoIdFromUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(videoIdFromUrl("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoIdFromUrl(undefined)).toBeNull();
  });

  it("merges repeat watches into one row with a play count and the latest time", () => {
    const r = parseTakeout(JSON.stringify([watch("aaaaaaaaaaa", { time: "2026-11-02T00:00:00Z" }), watch("aaaaaaaaaaa", { time: "2026-11-05T00:00:00Z" }), watch("bbbbbbbbbbb")]));
    const rows = dedupeWatched(r.entries);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.videoId === "aaaaaaaaaaa")).toMatchObject({ plays: 2, lastAt: Date.parse("2026-11-05T00:00:00Z") });
  });

  it("rejects search-history.json with a clear message", () => {
    const search = [1, 2, 3].map((i) => ({ header: "YouTube", title: `Searched for thing ${i}`, titleUrl: `https://www.youtube.com/results?search_query=thing+${i}`, time: "2026-11-01T10:00:00Z", products: ["YouTube"] }));
    try { parseTakeout(JSON.stringify(search)); expect.unreachable(); } catch (e) { expect((e as TakeoutError).code).toBe("search"); expect((e as Error).message).toMatch(/search-history/); }
    // Search URLs alone are enough, whatever the title says.
    expect(() => parseTakeout(JSON.stringify([{ title: "x", titleUrl: "https://www.youtube.com/results?search_query=a" }]))).toThrowError(/search-history/);
  });

  it("rejects a file with no valid watch entries instead of returning an empty history", () => {
    try { parseTakeout("[]"); expect.unreachable(); } catch (e) { expect((e as TakeoutError).code).toBe("no_watches"); }
    expect(() => parseTakeout(JSON.stringify([{ title: "Watched a video that has been removed" }, { header: "YouTube Music", title: "Watched Song", titleUrl: "https://music.youtube.com/watch?v=aaaaaaaaaaa" }]))).toThrowError(/No watched videos/);
  });

  it("a rejected upload leaves the stored history untouched", () => {
    const s = createStore(openDb(":memory:"));
    importTakeout(s, JSON.stringify([watch("aaaaaaaaaaa"), watch("bbbbbbbbbbb")]));
    expect(s.yt.watchedCount()).toBe(2);
    const search = JSON.stringify([{ header: "YouTube", title: "Searched for x", titleUrl: "https://www.youtube.com/results?search_query=x" }]);
    for (const bad of [search, "[]", "<html></html>", "not json"]) expect(() => importTakeout(s, bad)).toThrow();
    expect(s.yt.watchedCount()).toBe(2);
    expect(s.yt.watchedIds().has("aaaaaaaaaaa")).toBe(true);
  });
});
