import { describe, expect, it } from "vitest";
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
});
