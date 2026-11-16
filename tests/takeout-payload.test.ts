import { describe, expect, it } from "vitest";
import { chunkVideos, compactTakeout, MAX_TAKEOUT_VIDEOS, TAKEOUT_CHUNK_SIZE, TakeoutError } from "../src/core/takeout";
import { openDb } from "../src/server/db";
import { importTakeout } from "../src/server/detour";
import { createStore } from "../src/server/store";
import { STAGE_TTL_MS } from "../src/server/ytstore";
import { MAX_CHUNK_BYTES, validateTakeoutPayload } from "../src/server/takeout-payload";

const watch = (id: string, over: Record<string, unknown> = {}) => ({
  header: "YouTube",
  title: `Watched Video ${id}`,
  titleUrl: `https://www.youtube.com/watch?v=${id}`,
  subtitles: [{ name: "Some Channel", url: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" }],
  time: "2026-11-01T10:00:00.000Z",
  products: ["YouTube"],
  ...over,
});
const vid = (n: number) => `v${String(n).padStart(10, "0")}`;
const row = (n: number) => ({ videoId: vid(n), title: `Video ${n}`, channel: "C", channelId: "UCabcdefghijklmnopqrstuv", lastAt: 1_700_000_000_000 + n, plays: 1 });
const chunk = (videos: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ phase: "chunk", uploadId: "upload-12345678", index: 0, videos, ...over });
const commit = (over: Record<string, unknown> = {}) => JSON.stringify({ phase: "commit", uploadId: "upload-12345678", rows: 3, skipped: { ads: 0, music: 0, removed: 0, other: 0 }, ...over });

describe("compact Takeout payload validator", () => {
  it("accepts a chunk and a commit", () => {
    expect(validateTakeoutPayload(chunk([row(1), row(2)])).ok).toBe(true);
    expect(validateTakeoutPayload(commit()).ok).toBe(true);
    expect(validateTakeoutPayload(chunk([{ ...row(1), channel: null, channelId: null }])).ok).toBe(true);
  });

  it("rejects an oversize body with 413, before parsing it", () => {
    const r = validateTakeoutPayload("x".repeat(MAX_CHUNK_BYTES + 1));
    expect(r).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects too many rows in one chunk, and an empty chunk", () => {
    const many = Array.from({ length: TAKEOUT_CHUNK_SIZE + 1 }, (_, i) => row(i));
    expect(validateTakeoutPayload(chunk(many))).toMatchObject({ ok: false, status: 400 });
    expect(validateTakeoutPayload(chunk([]))).toMatchObject({ ok: false, status: 400 });
    expect(validateTakeoutPayload(chunk([row(1)], { index: Math.ceil(MAX_TAKEOUT_VIDEOS / TAKEOUT_CHUNK_SIZE) }))).toMatchObject({ ok: false });
  });

  it("rejects malformed JSON and malformed rows", () => {
    expect(validateTakeoutPayload("{nope")).toMatchObject({ ok: false, status: 400, error: "Body must be JSON." });
    expect(validateTakeoutPayload("[]")).toMatchObject({ ok: false, status: 400 });
    expect(validateTakeoutPayload(JSON.stringify({ phase: "wipe", uploadId: "upload-12345678" }))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([{ ...row(1), videoId: "short" }]))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([{ ...row(1), title: "x".repeat(201) }]))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([{ ...row(1), plays: 0 }]))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([{ ...row(1), lastAt: "yesterday" }]))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([{ ...row(1), extra: "field" }]))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(chunk([row(1)], { uploadId: "../etc" }))).toMatchObject({ ok: false });
    expect(validateTakeoutPayload(commit({ skipped: { ads: -1, music: 0, removed: 0, other: 0 } }))).toMatchObject({ ok: false });
  });
});

describe("compact Takeout through the store", () => {
  const text = JSON.stringify([watch("aaaaaaaaaaa"), watch("aaaaaaaaaaa", { time: "2026-11-02T10:00:00.000Z" }), watch("bbbbbbbbbbb"), watch("ccccccccccc", { details: [{ name: "From Google Ads" }] })]);

  it("reduces a file to the same rows the full-file import stores", () => {
    const full = createStore(openDb(":memory:"));
    importTakeout(full, text);
    const c = compactTakeout(text);
    expect(c).toMatchObject({ rows: 4, skipped: { ads: 1 } });
    const viaChunks = createStore(openDb(":memory:"));
    for (const videos of chunkVideos(c.videos, 1)) viaChunks.yt.stageWatched("upload-12345678", videos);
    expect(viaChunks.yt.commitWatched("upload-12345678")).toEqual({ videos: 2, channels: 1 });
    expect(viaChunks.yt.channelRows()).toEqual(full.yt.channelRows());
    expect(viaChunks.yt.recentWatchedIds(10)).toEqual(full.yt.recentWatchedIds(10));
  });

  it("never lets two interleaved uploads erase each other's chunks", () => {
    const s = createStore(openDb(":memory:"));
    const row = (i: number) => ({ videoId: vid(i), title: "t", channel: null, channelId: null, lastAt: 1, plays: 1 });
    s.yt.stageWatched("upload-aaaaaaaa", [row(1)]);
    s.yt.stageWatched("upload-bbbbbbbb", [row(2)]);
    s.yt.stageWatched("upload-aaaaaaaa", [row(3)]);
    expect(s.yt.commitWatched("upload-aaaaaaaa")).toEqual({ videos: 2, channels: 0 });
    expect([...s.yt.watchedIds()].sort()).toEqual([vid(1), vid(3)].sort());
    s.yt.stageWatched("upload-bbbbbbbb", [row(4)]);
    expect(s.yt.commitWatched("upload-bbbbbbbb")).toEqual({ videos: 2, channels: 0 });
    expect([...s.yt.watchedIds()].sort()).toEqual([vid(2), vid(4)].sort());
  });

  it("drops an abandoned upload after an hour, and only then", () => {
    const s = createStore(openDb(":memory:"));
    const row = (i: number) => ({ videoId: vid(i), title: "t", channel: null, channelId: null, lastAt: 1, plays: 1 });
    s.yt.stageWatched("upload-aaaaaaaa", [row(1)], 1_000);
    s.yt.stageWatched("upload-bbbbbbbb", [row(2)], 1_000 + STAGE_TTL_MS - 1);
    expect(s.yt.stagedCount("upload-aaaaaaaa")).toBe(1);
    s.yt.stageWatched("upload-bbbbbbbb", [row(3)], 1_000 + STAGE_TTL_MS + 1);
    expect(s.yt.stagedCount("upload-aaaaaaaa")).toBe(0);
    expect(s.yt.stagedCount("upload-bbbbbbbb")).toBe(2);
  });

  it("keeps the old history until the commit, and replaces it whole", () => {
    const s = createStore(openDb(":memory:"));
    importTakeout(s, text);
    expect(s.yt.watchedCount()).toBe(2);
    s.yt.stageWatched("upload-aaaaaaaa", [{ videoId: vid(1), title: "t", channel: null, channelId: null, lastAt: 1, plays: 1 }]);
    expect(s.yt.watchedCount()).toBe(2); // a half-finished upload changes nothing
    expect(s.yt.commitWatched("upload-zzzzzzzz")).toBeNull(); // nothing staged under that id
    expect(s.yt.watchedCount()).toBe(2);
    expect(s.yt.commitWatched("upload-aaaaaaaa")).toEqual({ videos: 1, channels: 0 });
    expect([...s.yt.watchedIds()]).toEqual([vid(1)]);
    s.yt.stageWatched("upload-bbbbbbbb", [{ videoId: vid(2), title: "t", channel: null, channelId: null, lastAt: 1, plays: 1 }]);
    expect(s.yt.commitWatched("upload-bbbbbbbb")).toEqual({ videos: 1, channels: 0 });
    expect([...s.yt.watchedIds()]).toEqual([vid(2)]);
  });

  it("parses with the same errors as the server parser", () => {
    expect(() => compactTakeout("<html></html>")).toThrow(TakeoutError);
    expect(() => compactTakeout("[]")).toThrow(/No watched videos/);
  });
});
