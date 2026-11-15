import { describe, expect, it } from "vitest";
import { channelHistogram, clusterOverlap, mainCluster, suggestFields, topicHistogram, topicLabel, type VideoMeta } from "../src/core/topics";

const wiki = (t: string) => `https://en.wikipedia.org/wiki/${t}`;
const meta = (id: string, topics: string[], categoryId: string | null = null, found = true): VideoMeta => ({ videoId: id, found, categoryId, topics: topics.map(wiki), channelId: null, channelTitle: null, title: null, seconds: 600 });

describe("topic histogram", () => {
  it("turns Wikipedia URLs into readable labels", () => {
    expect(topicLabel(wiki("Tourism"))).toBe("Travel");
    expect(topicLabel(wiki("Lifestyle_(sociology)"))).toBe("Lifestyle");
    expect(topicLabel(wiki("Role-playing_video_game"))).toBe("Role-playing games");
    expect(topicLabel(wiki("Classical_music"))).toBe("Classical music");
  });

  it("counts a video once per topic and gives shares of the videos with metadata", () => {
    const metas = [
      ...Array.from({ length: 6 }, (_, i) => meta(`t${i}`, ["Tourism", "Lifestyle_(sociology)"], "19")),
      meta("f1", ["Food", "Lifestyle_(sociology)"], "26"),
      meta("f2", ["Food", "Food"], "26"), // duplicate topic on one video counts once
      meta("x1", [], "27"),
      meta("gone", [], null, false), // not found: not in the total
    ];
    const h = topicHistogram(metas);
    expect(h.total).toBe(9);
    expect(h.topics[0]).toMatchObject({ label: "Lifestyle", count: 7 });
    expect(h.topics.find((t) => t.label === "Travel")).toMatchObject({ count: 6, share: 6 / 9 });
    expect(h.topics.find((t) => t.label === "Food")?.count).toBe(2);
    expect(h.categories.find((c) => c.label === "Travel & Events")?.count).toBe(6);
    expect(h.categories.find((c) => c.label === "Education")?.count).toBe(1);
  });

  it("sorts ties by label so the output is stable", () => {
    const h = topicHistogram([meta("a", ["Jazz"]), meta("b", ["Boxing"])]);
    expect(h.topics.map((t) => t.label)).toEqual(["Boxing", "Jazz"]);
  });

  it("builds the main cluster from specific topics with at least 10 % share, never the generic parents", () => {
    const metas = [...Array.from({ length: 7 }, (_, i) => meta(`t${i}`, ["Tourism", "Lifestyle_(sociology)"])), ...Array.from({ length: 2 }, (_, i) => meta(`f${i}`, ["Food", "Lifestyle_(sociology)"])), meta("m", ["Jazz"])];
    expect(mainCluster(topicHistogram(metas)).map((t) => t.label)).toEqual(["Travel", "Food", "Jazz"]); // Jazz is 1 of 10, exactly 10 %: it joins as the third
  });

  it("measures how much of a video sits in the cluster, ignoring parent topics", () => {
    const cluster = new Set(["Travel", "Food"]);
    expect(clusterOverlap([wiki("Tourism"), wiki("Lifestyle_(sociology)")], cluster)).toBe(1);
    expect(clusterOverlap([wiki("Tourism"), wiki("Physics")], cluster)).toBe(0.5);
    expect(clusterOverlap([wiki("Knowledge")], cluster)).toBe(0);
    expect(clusterOverlap([], cluster)).toBe(0);
  });

  it("clusters by channel when there is no topic data", () => {
    const h = channelHistogram([{ channel: "A", plays: 3 }, { channel: "B", plays: 1 }, { channel: null, plays: 9 }, { channel: "A", plays: 1 }]);
    expect(h.total).toBe(5);
    expect(h.channels[0]).toEqual({ channel: "A", count: 4, share: 0.8 });
  });
});

describe("suggested fields", () => {
  it("offers six categories under 2 % of the history, at most two per group", () => {
    const metas = [...Array.from({ length: 60 }, (_, i) => meta(`t${i}`, ["Tourism", "Technology"])), ...Array.from({ length: 40 }, (_, i) => meta(`f${i}`, ["Food"]))];
    const out = suggestFields(topicHistogram(metas));
    expect(out).toHaveLength(6);
    expect(out.every((s) => s.share !== null && s.share < 0.02)).toBe(true);
    expect(out.map((s) => s.label)).not.toContain("Technology"); // 60 %
    expect(out.map((s) => s.label)).not.toContain("Food"); // 40 %
    const groups = out.map((s) => s.group);
    for (const g of new Set(groups)) expect(groups.filter((x) => x === g).length).toBeLessThanOrEqual(2);
  });

  it("skips fields the owner already named, and falls back to the list order without topic data", () => {
    const out = suggestFields(null, ["Classical Music"]);
    expect(out).toHaveLength(6);
    expect(out.map((s) => s.query)).not.toContain("classical music");
    expect(out.every((s) => s.share === null)).toBe(true);
  });
});
