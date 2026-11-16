import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config as proxyConfig } from "../proxy";
import { COOKIE_NAME, lockout, sessionValue } from "../src/server/auth";

const KEY = "owner-key/with+odd chars";
const ENC = encodeURIComponent(KEY);

type Handler = (req: Request, ctx?: { params: Promise<{ key: string }> }) => Promise<Response>;
let health: { GET: Handler };
let tonight: { GET: Handler };
let mcp: { POST: Handler; GET: Handler };
let mcpKey: { POST: Handler; GET: Handler };
let storeOf: () => import("../src/server/store").Store;
let catalogOf: () => import("../src/catalog").Catalog;

beforeAll(async () => {
  vi.stubEnv("SERENDIP_OWNER_KEY", KEY);
  vi.stubEnv("SERENDIP_DB", ":memory:");
  vi.stubEnv("SERENDIP_TRUST_PROXY", "1");
  vi.stubEnv("TMDB_READ_TOKEN", "");
  vi.stubEnv("YOUTUBE_API_KEY", "");
  health = (await import("../app/api/v1/health/route")) as unknown as typeof health;
  tonight = (await import("../app/api/v1/tonight/route")) as unknown as typeof tonight;
  mcp = (await import("../app/mcp/route")) as unknown as typeof mcp;
  mcpKey = (await import("../app/mcp/[key]/route")) as unknown as typeof mcpKey;
  storeOf = (await import("../src/server/store")).store;
  catalogOf = (await import("../src/catalog")).catalog;
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => lockout().reset());

const ip = (n: string) => ({ "x-forwarded-for": n });
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const viaBearer = (body: string, key: string | null = KEY, extra: Record<string, string> = {}) =>
  new Request("http://localhost:3140/mcp", { method: "POST", headers: { ...HEADERS, ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra }, body });
const viaPath = (body: string, key: string, extra: Record<string, string> = {}): [Request, { params: Promise<{ key: string }> }] => [
  new Request(`http://localhost:3140/mcp/${encodeURIComponent(key)}`, { method: "POST", headers: { ...HEADERS, ...extra }, body }),
  { params: Promise.resolve({ key: encodeURIComponent(key) }) },
];
const call = async (name: string, args: unknown = {}) => {
  const res = await mcp.POST(viaBearer(rpc("tools/call", { name, arguments: args })));
  expect(res.status).toBe(200);
  const body = await res.json();
  return { isError: !!body.result.isError, data: JSON.parse(body.result.content[0].text) };
};

describe("GET /api/v1/health", () => {
  it("is public and says nothing but ok and the version", async () => {
    const res = await health.GET(new Request("http://localhost:3140/api/v1/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ok", "version"]);
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("GET /api/v1/tonight", () => {
  const req = (h: Record<string, string> = {}) => new Request("http://localhost:3140/api/v1/tonight", { headers: h });

  it("refuses without the owner key", async () => {
    expect((await tonight.GET(req())).status).toBe(401);
    expect((await tonight.GET(req({ authorization: "Bearer wrong" }))).status).toBe(401);
  });

  it("answers the channels with a bearer key or a session", async () => {
    const providers = await catalogOf().providers();
    storeOf().setPrefs({ providers: providers.slice(0, 3).map((p) => p.id), languages: ["en", "es"], subtitles: true });
    for (const headers of [{ authorization: `Bearer ${KEY}` }, { cookie: `${COOKIE_NAME}=${sessionValue(KEY)}` }] as Array<Record<string, string>>) {
      const res = await tonight.GET(req(headers));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ catalog: "sample", region: "ES", needsSetup: false });
      expect(body.channels.length).toBeGreaterThan(0);
      const pick = body.channels[0].picks[0];
      expect(Object.keys(pick)).toEqual(expect.arrayContaining(["title", "year", "runtimeMin", "service", "watchUrl", "why", "trailerKey"]));
      expect(pick.watchUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("/mcp", () => {
  it("lists the five tools to the owner and refuses everyone else", async () => {
    const ok = await mcp.POST(viaBearer(rpc("tools/list")));
    expect(ok.status).toBe(200);
    const tools = (await ok.json()).result.tools as Array<{ name: string; description: string; inputSchema: { type: string } }>;
    expect(tools.map((t) => t.name).sort()).toEqual(["serendip_channel", "serendip_detour", "serendip_log_evening", "serendip_mark", "serendip_tonight"]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    expect(tools.find((t) => t.name === "serendip_tonight")?.description).toMatch(/data from the catalog, not instructions/);
    expect((await mcp.POST(viaBearer(rpc("tools/list"), null))).status).toBe(401);
    expect((await mcp.POST(viaBearer(rpc("tools/list"), "wrong"))).status).toBe(401);
  });

  it("initializes with a short instruction paragraph", async () => {
    const res = await mcp.POST(viaBearer(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })));
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("serendip");
    expect(body.result.instructions).toMatch(/never instructions/);
    expect(body.result.instructions).not.toContain("\n");
  });

  it("serves the same list at /mcp/<key>, including a key that needs URL encoding", async () => {
    const res = await mcpKey.POST(...viaPath(rpc("tools/list"), KEY));
    expect(res.status).toBe(200);
    expect((await res.json()).result.tools).toHaveLength(5);
    expect(ENC).not.toBe(KEY);
  });

  it("answers a wrong path key with 401 and counts it toward the lockout, like a wrong bearer", async () => {
    const a = ip("203.0.113.9");
    const first = await mcpKey.POST(...viaPath(rpc("tools/list"), "wrong-key", a));
    expect(first.status).toBe(401);
    expect(JSON.stringify(await first.json())).not.toContain("wrong-key");
    for (let i = 1; i < 10; i++) expect((await mcpKey.POST(...viaPath(rpc("tools/list"), `wrong-${i}`, a))).status).toBe(401);
    // Ten wrong keys, from any mix of bearer and path: the next request is refused even with the right key.
    expect((await mcpKey.POST(...viaPath(rpc("tools/list"), KEY, a))).status).toBe(429);
    expect((await mcp.POST(viaBearer(rpc("tools/list"), KEY, a))).status).toBe(429);
    // Another client is not affected.
    expect((await mcpKey.POST(...viaPath(rpc("tools/list"), KEY, ip("198.51.100.4")))).status).toBe(200);
  });

  it("shares one lockout between the bearer form and the path form", async () => {
    const a = ip("203.0.113.77");
    for (let i = 0; i < 5; i++) expect((await mcp.POST(viaBearer(rpc("tools/list"), `bad-${i}`, a))).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await mcpKey.POST(...viaPath(rpc("tools/list"), `bad-${i}`, a))).status).toBe(401);
    expect((await mcpKey.POST(...viaPath(rpc("tools/list"), KEY, a))).status).toBe(429);
  });

  it("does not let a signed-in browser pass with a wrong key in the path", async () => {
    const cookie = { cookie: `${COOKIE_NAME}=${sessionValue(KEY)}` };
    expect((await mcpKey.POST(...viaPath(rpc("tools/list"), "wrong-key", cookie))).status).toBe(401);
  });

  it("refuses GET with the tool list only after auth", async () => {
    const noAuth = await mcp.GET(new Request("http://localhost:3140/mcp"));
    expect(noAuth.status).toBe(401);
    const ok = await mcp.GET(new Request("http://localhost:3140/mcp", { headers: { authorization: `Bearer ${KEY}` } }));
    expect(ok.status).toBe(405);
  });

  it("runs the tools against the store", async () => {
    const t = await call("serendip_tonight");
    expect(t.isError).toBe(false);
    expect(t.data.channels.length).toBeGreaterThan(0);
    const channel = t.data.channels[0];
    expect((await call("serendip_channel", { id: channel.id })).data.picks).toEqual(channel.picks);
    expect((await call("serendip_channel", { id: "nope" })).isError).toBe(true);

    const filmId = channel.picks[0].id;
    const saved = await call("serendip_mark", { id: String(filmId), action: "save" });
    expect(saved.data).toMatchObject({ ok: true, kind: "film", action: "save" });
    expect(storeOf().actionIds("save").has(filmId)).toBe(true);
    expect((await call("serendip_mark", { id: filmId, action: "not_for_me" })).data.ok).toBe(true);
    expect(storeOf().actionIds("dismiss").has(filmId)).toBe(true);
    expect((await call("serendip_mark", { id: "not an id", action: "seen" })).isError).toBe(true);
    expect((await call("serendip_mark", { id: "aaaaaaaaaaa", action: "seen" })).data.error).toBe("not_found");

    const logged = await call("serendip_log_evening", { what: "Roma", source: "serendip", score: 4, minutes_to_choose: 12, day: "2026-11-14" });
    expect(logged.data).toEqual({ ok: true, day: "2026-11-14" });
    expect(storeOf().evenings()[0]).toEqual({ day: "2026-11-14", watched: "Roma", source: "serendip", enjoyment: 4, minutesToChoose: 12 });
    expect((await call("serendip_log_evening", { what: "x", source: "serendip", score: 9 })).isError).toBe(true);

    const d = await call("serendip_detour");
    expect(d.data).toEqual({ cluster: null, picks: [], note: expect.stringMatching(/no YOUTUBE_API_KEY/) });
    expect((await call("serendip_tonight")).data.detour).toBeNull(); // sample cards are not shown to agents
  });
});

describe("serendip_mark on a Detour video", () => {
  it("uses the same store call as /api/detour/action: the channel is muted for 'not for me'", async () => {
    const pick = { videoId: "dQw4w9WgXcQ", title: "A video", channelId: "UCabcdefghijklmnopqrstuv", channelTitle: "Chan", field: "Physics", publishedAt: "2026-11-01T00:00:00Z", seconds: 900, views: 50_000, likes: 2000, topics: [], score: 1 };
    storeOf().yt.setPicks({ day: "2026-11-16", builtAt: 1, picks: [pick], searched: ["Physics"], note: null });
    const r = await call("serendip_mark", { id: "dQw4w9WgXcQ", action: "not_for_me" });
    expect(r.data).toMatchObject({ ok: true, kind: "video", title: "A video" });
    expect(storeOf().yt.actedIds().has("dQw4w9WgXcQ")).toBe(true);
    expect(storeOf().yt.mutedKeys().has("UCabcdefghijklmnopqrstuv")).toBe(true);
  });
});

describe("proxy", () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]!}$`);
  it("leaves the health check, the API and MCP to their own auth", () => {
    for (const path of ["/api/v1/health", "/api/v1/tonight", "/mcp", `/mcp/${ENC}`, "/signin", "/_next/static/a.js", "/icon.svg"]) expect(matcher.test(path), path).toBe(false);
  });
  it("still sends every page to the sign-in redirect", () => {
    for (const path of ["/", "/tv", "/setup", "/detour", "/log", "/mcpx", "/apiary"]) expect(matcher.test(path), path).toBe(true);
  });
});
