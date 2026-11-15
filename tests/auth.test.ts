import { describe, expect, it } from "vitest";
import { authenticate, COOKIE_NAME, createLockout, safeNextPath, sessionValue } from "../src/server/auth";
import { watchUrl, trailerEmbed } from "../src/core/watch";
import { formatRuntime } from "../src/core/why";

const env = { SERENDIP_OWNER_KEY: "secret-key" };

describe("owner key", () => {
  it("refuses everything when no key is set", () => {
    expect(authenticate({ authorization: "Bearer x" }, {})).toMatchObject({ ok: false, status: 503 });
  });
  it("accepts the bearer key and the session cookie, and nothing else", () => {
    expect(authenticate({ authorization: "Bearer secret-key" }, env)).toMatchObject({ ok: true, via: "bearer" });
    expect(authenticate({ cookie: `${COOKIE_NAME}=${sessionValue("secret-key")}` }, env)).toMatchObject({ ok: true, via: "cookie" });
    expect(authenticate({ authorization: "Bearer nope" }, env)).toMatchObject({ ok: false, status: 401, presented: true });
    expect(authenticate({ cookie: `${COOKIE_NAME}=raw-key` }, env)).toMatchObject({ ok: false, presented: false });
  });
  it("locks a client out after ten wrong keys", () => {
    const l = createLockout({ perKey: 3, windowMs: 1000, now: () => 0 });
    for (let i = 0; i < 3; i++) l.fail("ip");
    expect(l.locked("ip")).toBe(true);
    expect(l.locked("other")).toBe(false);
  });
  it("keeps next paths on this site", () => {
    expect(safeNextPath("/tv?v=b")).toBe("/tv?v=b");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/\t/evil", undefined]) expect(safeNextPath(bad)).toBe("/");
  });
});

describe("watch links and formatting", () => {
  it("uses a provider's own search when the format is known, else the TMDB watch page", () => {
    expect(watchUrl({ id: 1, title: "Mad Max: Fury Road" }, { id: 8, name: "Netflix" })).toBe("https://www.netflix.com/search?q=Mad%20Max%3A%20Fury%20Road");
    expect(watchUrl({ id: 603, title: "The Matrix" }, { id: 63, name: "Filmin" })).toBe("https://www.themoviedb.org/movie/603/watch?locale=ES");
    expect(watchUrl({ id: 9_000_001, title: "Arrival", sample: true }, { id: 63, name: "Filmin" })).toContain("themoviedb.org/search?query=Arrival");
  });
  it("embeds the trailer muted and autoplaying from youtube-nocookie", () => {
    const u = trailerEmbed("abc123XYZ_-", 12);
    expect(u).toContain("https://www.youtube-nocookie.com/embed/abc123XYZ_-");
    expect(u).toContain("autoplay=1");
    expect(u).toContain("mute=1");
  });
  it("formats runtimes like the why line", () => {
    expect(formatRuntime(116)).toBe("1 h 56");
    expect(formatRuntime(125)).toBe("2 h 05");
    expect(formatRuntime(45)).toBe("45 min");
    expect(formatRuntime(null)).toBe("length unknown");
  });
});
