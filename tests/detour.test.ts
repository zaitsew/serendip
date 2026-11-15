import { describe, expect, it } from "vitest";
import {
  allowedSearches, cleanFields, DAILY_SEARCH_BUDGET, DAY_MS, DETOUR, detourEmbed, detourWhy, dropReason, filterCandidates, planPlaylistSync, planSearches, quotaDay, score, selectDetour, topChannels,
  type Candidate, type DetourContext,
} from "../src/core/detour";
import { refreshDetour, type DetourDeps } from "../src/server/detour";
import { openDb } from "../src/server/db";
import { createStore } from "../src/server/store";
import type { SearchHit, VideoDetail, YoutubeClient } from "../src/youtube/api";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const wiki = (t: string) => `https://en.wikipedia.org/wiki/${t}`;

const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  videoId: id, title: `Video ${id}`, channelId: `UC_${id}`, channelTitle: `Channel ${id}`, field: "physics", publishedAt: new Date(NOW - 100 * DAY_MS).toISOString(),
  seconds: 900, views: 200_000, likes: 8_000, topics: [wiki("Knowledge")], ...over,
});
const ctx = (over: Partial<DetourContext> = {}): DetourContext => ({ now: NOW, watched: new Set(), topChannelIds: new Set(), topChannelNames: new Set(), muted: new Set(), cluster: new Set(["Travel"]), fieldDismissals: {}, ...over });

describe("detour filters", () => {
  it("drops Shorts under four minutes", () => {
    expect(dropReason(cand("a", { seconds: DETOUR.minSeconds - 1 }), ctx())).toBe("short");
    expect(dropReason(cand("a", { seconds: DETOUR.minSeconds }), ctx())).toBeNull();
  });
  it("drops watched videos, top channels (by id or name) and muted channels", () => {
    expect(dropReason(cand("a"), ctx({ watched: new Set(["a"]) }))).toBe("watched");
    expect(dropReason(cand("a"), ctx({ topChannelIds: new Set(["UC_a"]) }))).toBe("top-channel");
    expect(dropReason(cand("a", { channelId: null, channelTitle: "Big Name" }), ctx({ topChannelNames: new Set(["big name"]) }))).toBe("top-channel");
    expect(dropReason(cand("a"), ctx({ muted: new Set(["UC_a"]) }))).toBe("muted");
    expect(dropReason(cand("a", { channelId: null, channelTitle: "Quiet One" }), ctx({ muted: new Set(["quiet one"]) }))).toBe("muted");
  });
  it("drops videos whose topics are more than half inside the main cluster", () => {
    expect(dropReason(cand("a", { topics: [wiki("Tourism"), wiki("Lifestyle_(sociology)")] }), ctx())).toBe("cluster");
    expect(dropReason(cand("a", { topics: [wiki("Tourism"), wiki("Physics")] }), ctx())).toBeNull(); // exactly 50 % stays
    expect(dropReason(cand("a", { topics: [] }), ctx())).toBeNull();
  });
  it("drops low quality: under 20k views or under 1.5 % likes; hidden likes pass", () => {
    expect(dropReason(cand("a", { views: DETOUR.minViews - 1 }), ctx())).toBe("low-quality");
    expect(dropReason(cand("a", { views: 100_000, likes: 1_400 }), ctx())).toBe("low-quality");
    expect(dropReason(cand("a", { views: 100_000, likes: 1_500 }), ctx())).toBeNull();
    expect(dropReason(cand("a", { likes: null }), ctx())).toBeNull();
  });
  it("filterCandidates keeps only what passes", () => {
    expect(filterCandidates([cand("a"), cand("b", { seconds: 30 })], ctx()).map((c) => c.videoId)).toEqual(["a"]);
  });
});

describe("detour ranking", () => {
  it("scores a better like ratio, more views and a newer upload higher", () => {
    const base = cand("a");
    expect(score({ ...base, likes: 12_000 }, ctx())).toBeGreaterThan(score(base, ctx()));
    expect(score({ ...base, views: 2_000_000, likes: 80_000 }, ctx())).toBeGreaterThan(score(base, ctx()));
    expect(score({ ...base, publishedAt: new Date(NOW - 10 * DAY_MS).toISOString() }, ctx())).toBeGreaterThan(score({ ...base, publishedAt: new Date(NOW - 900 * DAY_MS).toISOString() }, ctx()));
  });
  it("lowers a field's score for each Not for me, up to a cap", () => {
    const c = cand("a");
    const one = score(c, ctx({ fieldDismissals: { physics: 1 } }));
    expect(one).toBeCloseTo(score(c, ctx()) - DETOUR.fieldPenalty, 10);
    expect(score(c, ctx({ fieldDismissals: { physics: 99 } }))).toBeCloseTo(score(c, ctx()) - DETOUR.fieldPenalty * DETOUR.maxFieldDismissals, 10);
  });
  it("keeps one video per channel and at most 12, dealing round-robin across fields", () => {
    const fields = ["physics", "architecture", "jazz"];
    const cands: Candidate[] = [];
    for (let i = 0; i < 30; i++) cands.push(cand(`v${String(i).padStart(2, "0")}`, { field: fields[i % 3]!, views: 100_000 + i * 10_000, channelId: `UC_${i % 25}` })); // 25 channels, 30 videos
    const out = selectDetour(cands, ctx());
    expect(out).toHaveLength(DETOUR.keep);
    expect(new Set(out.map((o) => o.channelId)).size).toBe(out.length);
    const counts = fields.map((f) => out.filter((o) => o.field === f).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // Deterministic: the same input gives the same list.
    expect(selectDetour([...cands].reverse(), ctx()).map((o) => o.videoId)).toEqual(out.map((o) => o.videoId));
  });
  it("deals a heavily dismissed field last", () => {
    const cands = [cand("a", { field: "physics", channelId: "1" }), cand("b", { field: "jazz", channelId: "2" })];
    expect(selectDetour(cands, ctx({ fieldDismissals: { physics: 4 } })).map((o) => o.field)).toEqual(["jazz", "physics"]);
  });
  it("de-duplicates a video that two fields both found", () => {
    expect(selectDetour([cand("a", { field: "x" }), cand("a", { field: "y" })], ctx())).toHaveLength(1);
  });
  it("finds the top channels by plays", () => {
    const rows = [{ channel: "A", channelId: "UC1", plays: 5 }, { channel: "B", channelId: null, plays: 9 }, { channel: "C", channelId: "UC3", plays: 1 }];
    const t = topChannels(rows, 2);
    expect([...t.names]).toEqual(["b", "a"]);
    expect([...t.ids]).toEqual(["UC1"]);
  });
  it("writes the why line", () => {
    expect(detourWhy({ field: "Physics", clusterTop: { label: "Travel", share: 0.62 } })).toBe("Physics · away from Travel (62 % of your history)");
    expect(detourWhy({ field: "Physics", clusterTop: null })).toBe("Physics · outside your usual");
  });
  it("cleans the fields: trims, dedupes, caps at 8", () => {
    expect(cleanFields(["  physics ", "Physics", "a", "", "architecture   history"])).toEqual(["physics", "architecture history"]);
    expect(cleanFields(Array.from({ length: 12 }, (_, i) => `field ${i}`))).toHaveLength(8);
  });
  it("embeds youtube-nocookie: muted preview, sound on watch", () => {
    expect(detourEmbed("dQw4w9WgXcQ", "preview")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?.*mute=1/);
    const w = detourEmbed("dQw4w9WgXcQ", "watch");
    expect(w).toContain("autoplay=1");
    expect(w).not.toContain("mute=1");
  });
});

describe("search planning and budget", () => {
  it("plans one medium search per field first, then long ones, never above the budget", () => {
    expect(planSearches(["a", "b"], 12)).toEqual([
      { field: "a", duration: "medium" }, { field: "b", duration: "medium" }, { field: "a", duration: "long" }, { field: "b", duration: "long" },
    ]);
    const eight = Array.from({ length: 8 }, (_, i) => `f${i}`);
    const p = planSearches(eight, DAILY_SEARCH_BUDGET);
    expect(p).toHaveLength(12);
    expect(p.filter((t) => t.duration === "medium")).toHaveLength(8);
    expect(planSearches(eight, 3)).toHaveLength(3);
    expect(planSearches(eight, 0)).toEqual([]);
    expect(planSearches([], 12)).toEqual([]);
  });
  it("rotates the start so a second run does not repeat the first", () => {
    expect(planSearches(["a", "b", "c"], 2, 2).map((t) => t.field)).toEqual(["c", "a"]);
  });
  it("allows only what is left of the budget", () => {
    expect(allowedSearches(0, 20)).toBe(DAILY_SEARCH_BUDGET);
    expect(allowedSearches(10, 5)).toBe(2);
    expect(allowedSearches(12, 5)).toBe(0);
    expect(allowedSearches(40, 5)).toBe(0);
  });
  it("counts the quota day in Pacific time", () => {
    expect(quotaDay(Date.parse("2026-11-15T06:00:00Z"))).toBe("2026-11-14"); // 22:00 on the 14th in Los Angeles
    expect(quotaDay(Date.parse("2026-11-15T09:00:00Z"))).toBe("2026-11-15");
  });
});

describe("playlist plan", () => {
  it("removes old and duplicate items, keeps overlap, inserts the rest at their rank", () => {
    const existing = [{ itemId: "i1", videoId: "A" }, { itemId: "i2", videoId: "B" }, { itemId: "i3", videoId: "A" }, { itemId: "i4", videoId: "Z" }];
    expect(planPlaylistSync(existing, ["C", "A", "D"])).toEqual({ remove: ["i2", "i3", "i4"], add: [{ videoId: "C", position: 0 }, { videoId: "D", position: 2 }] });
    expect(planPlaylistSync([], ["A"])).toEqual({ remove: [], add: [{ videoId: "A", position: 0 }] });
  });
});

// A fake YouTube: every search returns 12 fresh videos for the field, details pass the filters.
function fakeYt() {
  const calls = { search: 0, videos: 0, queries: [] as string[] };
  let n = 0;
  const yt: YoutubeClient = {
    async search({ q }) {
      calls.search++;
      calls.queries.push(q);
      const hits: SearchHit[] = [];
      for (let i = 0; i < 12; i++) { n++; hits.push({ videoId: `v${String(n).padStart(10, "0")}`.slice(0, 11), title: `T${n}`, channelId: `UC${n}`, channelTitle: `Ch ${n}`, publishedAt: new Date(NOW - 30 * DAY_MS).toISOString() }); }
      return hits;
    },
    async videos(ids): Promise<VideoDetail[]> {
      calls.videos++;
      return ids.map((videoId) => ({ videoId, found: true, categoryId: "27", topics: [wiki("Knowledge")], channelId: null, channelTitle: null, title: null, seconds: 1200, publishedAt: null, views: 500_000, likes: 20_000 }));
    },
  };
  return { yt, calls };
}

describe("refreshDetour enforces the daily budget", () => {
  const deps = (yt: YoutubeClient, now: number): DetourDeps => ({ yt, oauth: null, ownerKey: null, fetch, now: () => now });

  it("never makes more than 12 search calls in a quota day, however often it is pressed", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setFields(["physics", "architecture history", "jazz"]);
    const { yt, calls } = fakeYt();
    const first = await refreshDetour(s, deps(yt, NOW), { force: true });
    expect(first).toMatchObject({ status: "built", picks: 12 });
    expect(calls.search).toBe(6); // 3 fields: medium and long each
    await refreshDetour(s, deps(yt, NOW), { force: true });
    expect(calls.search).toBe(12);
    const third = await refreshDetour(s, deps(yt, NOW), { force: true });
    expect(third.status).toBe("budget");
    expect(calls.search).toBe(12);
    expect(s.yt.searchesToday(quotaDay(NOW))).toBe(12);
    expect(s.yt.unitsToday(quotaDay(NOW))).toBeGreaterThanOrEqual(1200); // 12 searches at 100 units
    // The next quota day starts fresh.
    const tomorrow = await refreshDetour(s, deps(yt, NOW + DAY_MS), { force: true });
    expect(tomorrow.status).toBe("built");
    expect(calls.search).toBe(18);
  });

  it("is lazy: once today's picks exist a plain call does nothing", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setFields(["physics"]);
    const { yt, calls } = fakeYt();
    await refreshDetour(s, deps(yt, NOW));
    const before = calls.search;
    expect(await refreshDetour(s, deps(yt, NOW + 3_600_000))).toMatchObject({ status: "fresh" });
    expect(calls.search).toBe(before);
  });

  it("counts a failing search against the budget and stops on a quota error", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setFields(["physics", "jazz"]);
    const { YoutubeError } = await import("../src/youtube/api");
    let calls = 0;
    const yt: YoutubeClient = { async search() { calls++; throw new YoutubeError(403, "quotaExceeded", "quota"); }, async videos() { return []; } };
    const r = await refreshDetour(s, deps(yt, NOW), { force: true });
    expect(r.status).toBe("error");
    expect(calls).toBe(1);
    expect(s.yt.searchesToday(quotaDay(NOW))).toBe(1);
    // The failure is remembered, so the lazy path waits instead of retrying on every /tv open.
    expect((await refreshDetour(s, deps(yt, NOW + 60_000))).status).toBe("waiting");
    expect(calls).toBe(1);
  });

  it("returns the sample status without a key and no_fields without fields", async () => {
    const s = createStore(openDb(":memory:"));
    expect((await refreshDetour(s, { yt: null, oauth: null, ownerKey: null, fetch, now: () => NOW })).status).toBe("sample");
    expect((await refreshDetour(s, deps(fakeYt().yt, NOW))).status).toBe("no_fields");
  });

  it("uses the S1 language setting, and Not for me mutes the channel and lowers the field", async () => {
    const s = createStore(openDb(":memory:"));
    s.setPrefs({ providers: [], languages: ["es", "en"], subtitles: true });
    s.yt.setFields(["physics"]);
    let lang: string | null = "unset";
    const { yt: inner } = fakeYt();
    const yt: YoutubeClient = { ...inner, async search(o) { lang = o.language; return inner.search(o); }, videos: inner.videos };
    await refreshDetour(s, deps(yt, NOW), { force: true });
    expect(lang).toBe("es");
    const picks = s.yt.getPicks()!.picks;
    const p = picks[0]!;
    s.yt.detourAct({ videoId: p.videoId, action: "dismiss", field: p.field, channelId: p.channelId, channelTitle: p.channelTitle, title: p.title });
    expect(s.yt.mutedKeys().has(p.channelId!)).toBe(true);
    expect(s.yt.fieldDismissals()).toEqual({ physics: 1 });
  });

  it("keeps the earlier picks of fields a stopped run never reached", async () => {
    const s = createStore(openDb(":memory:"));
    s.yt.setFields(["alpha", "beta"]);
    const { yt: ok } = fakeYt();
    await refreshDetour(s, deps(ok, NOW), { force: true });
    const before = s.yt.getPicks()!.picks;
    expect(before.some((p) => p.field === "beta")).toBe(true);
    const { YoutubeError } = await import("../src/youtube/api");
    // The next day: alpha answers, then the quota runs out before beta is reached.
    let n = 0;
    const flaky: YoutubeClient = {
      async search(o) { if (++n > 1) throw new YoutubeError(403, "quotaExceeded", "quota"); return ok.search(o); },
      videos: ok.videos,
    };
    const r = await refreshDetour(s, deps(flaky, NOW + DAY_MS), { force: true });
    expect(r.status).toBe("built");
    const after = s.yt.getPicks()!.picks;
    const beta = (list: typeof after) => list.filter((p) => p.field === "beta").map((p) => p.videoId).sort();
    expect(beta(after)).toEqual(beta(before)); // beta kept as it was
    expect(after.filter((p) => p.field === "alpha").map((p) => p.videoId)).not.toEqual(before.filter((p) => p.field === "alpha").map((p) => p.videoId));
  });
});
