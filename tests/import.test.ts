import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pickMatch } from "../src/core/match";
import { parseCsv } from "../src/import/csv";
import { looksLikeEpisode, parseLetterboxd, parseLetterboxdZip, parseNetflix } from "../src/import/parse";
import { readZip } from "../src/import/zip";
import { createSample } from "../src/catalog/sample";
import { openDb } from "../src/server/db";
import { importLetterboxd } from "../src/server/service";
import { createStore } from "../src/server/store";

/** Builds a ZIP in memory: entries are stored or deflated. */
function makeZip(files: Record<string, string>, deflate = false): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const body = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WATCHED = "Date,Name,Year,Letterboxd URI\n2020-01-01,Arrival,2016,https://boxd.it/a\n2020-01-02,\"Crouching Tiger, Hidden Dragon\",2000,https://boxd.it/b\n2020-01-03,Cats,2019,https://boxd.it/c\n";
const RATINGS = "Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Arrival,2016,https://boxd.it/a,4.5\n2020-01-03,Cats,2019,https://boxd.it/c,1\n";
const LIKES = "Date,Name,Year,Letterboxd URI\n2020-01-02,\"Crouching Tiger, Hidden Dragon\",2000,https://boxd.it/b\n";

describe("csv", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿Title,Date\r\n"Say ""hi"", ok",2020-01-01\r\nPlain,2020-01-02\r\n');
    expect(rows).toEqual([{ Title: 'Say "hi", ok', Date: "2020-01-01" }, { Title: "Plain", Date: "2020-01-02" }]);
  });
});

describe("zip", () => {
  it("reads stored and deflated entries", () => {
    for (const deflate of [false, true]) {
      const m = readZip(makeZip({ "a.txt": "hello", "likes/films.csv": "x,y" }, deflate));
      expect(m.get("a.txt")?.toString()).toBe("hello");
      expect(m.get("likes/films.csv")?.toString()).toBe("x,y");
    }
  });
  it("reads only the entries it wants and skips the rest", () => {
    const m = readZip(makeZip({ "a.csv": "keep", "junk.bin": "x".repeat(1000) }, true), { want: (n) => n === "a.csv", maxTotal: 100 });
    expect([...m.keys()]).toEqual(["a.csv"]);
  });
  it("refuses too many entries and too much expanded data", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.csv`, "a"]));
    expect(() => readZip(makeZip(many), { maxEntries: 10 })).toThrow(/too many entries/);
    const big = makeZip({ "a.csv": "x".repeat(60_000), "b.csv": "y".repeat(60_000) }, true);
    expect(() => readZip(big, { maxTotal: 100_000 })).toThrow(/too much data/);
    expect(() => readZip(makeZip({ "a.csv": "x".repeat(60_000) }, true), { maxEntry: 1000 })).toThrow(/too large/);
  });
  it("rejects a non-zip", () => {
    expect(() => readZip(Buffer.from("not a zip file at all, really not"))).toThrow(/ZIP/);
  });
});

describe("letterboxd", () => {
  const parsed = parseLetterboxdZip(makeZip({ "watched.csv": WATCHED, "ratings.csv": RATINGS, "likes/films.csv": LIKES }, true));

  it("treats everything watched as seen", () => {
    expect(parsed.watched.map((w) => w.title)).toEqual(["Arrival", "Crouching Tiger, Hidden Dragon", "Cats"]);
  });
  it("seeds from rating >= 4 or a like, not from a low rating", () => {
    expect(parsed.seeds.map((w) => w.title)).toEqual(["Arrival", "Crouching Tiger, Hidden Dragon"]);
    expect(parsed.watched.find((w) => w.title === "Cats")?.rating).toBe(1);
  });
  it("finds the files inside a folder", () => {
    const p = parseLetterboxd(new Map([["letterboxd-export/ratings.csv", Buffer.from(RATINGS)]]));
    expect(p.seeds.map((s) => s.title)).toEqual(["Arrival"]);
  });
});

describe("letterboxd re-import", () => {
  const zipWith = (rating: string) => makeZip({ "watched.csv": "Date,Name,Year,Letterboxd URI\n2020-01-01,Arrival,2016,x\n", "ratings.csv": `Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Arrival,2016,x,${rating}\n` });
  it("revokes a seed when the new export rates the film lower, and keeps setup seeds", async () => {
    const store = createStore(openDb(":memory:"));
    const cat = createSample();
    await importLetterboxd(store, cat, zipWith("5"));
    expect(store.ids("seed").size).toBe(1);
    await importLetterboxd(store, cat, zipWith("2"));
    expect(store.ids("seed").size).toBe(0);
    expect(store.ids("seen").size).toBe(1);
  });
});

describe("netflix", () => {
  it("skips series episode lines and repeated titles", () => {
    const csv = [
      "Title,Date",
      "Stranger Things: Season 4: Chapter 1,2022-06-01",
      "Stranger Things: Limited Series: Chapter 2,2022-06-01",
      "Dark: Temporada 1: Secretos,2022-06-02",
      "Roma,2021-03-01",
      "Roma,2021-03-02",
      "Okja,2020-01-01",
      "Mission: Impossible,2020-01-02",
    ].join("\n");
    const r = parseNetflix(csv);
    expect(r.titles).toEqual(["Roma", "Okja", "Mission: Impossible"]);
    expect(r.skippedEpisodes).toBe(3);
    expect(looksLikeEpisode("Mission: Impossible")).toBe(false);
  });
});

describe("matching", () => {
  const results = [
    { id: 1, title: "Alien", year: 1979, popularity: 50 },
    { id: 2, title: "Alien", year: 1986, popularity: 20 },
    { id: 3, title: "Amélie", originalTitle: "Le Fabuleux Destin d'Amélie Poulain", year: 2001, popularity: 40 },
  ];
  it("matches on title and year, within a year", () => {
    expect(pickMatch("Alien", 1979, results)?.id).toBe(1);
    expect(pickMatch("Alien", 1980, results)?.id).toBe(1);
    expect(pickMatch("Alien", 1990, results)).toBeNull();
  });
  it("ignores accents and case, and uses the original title too", () => {
    expect(pickMatch("amelie", 2001, results)?.id).toBe(3);
    expect(pickMatch("Le fabuleux destin d'Amélie Poulain", null, results)?.id).toBe(3);
  });
  it("without a year takes the most popular exact match, and never a partial one", () => {
    expect(pickMatch("Alien", null, results)?.id).toBe(1);
    expect(pickMatch("Alie", null, results)).toBeNull();
  });
});
