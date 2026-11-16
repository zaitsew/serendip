import { describe, expect, it } from "vitest";
import { DEFAULT_REDIRECT, isLocalRedirect, oauthConfig, redirectUri } from "../src/youtube/oauth";
import { siteUrl } from "../src/server/http";

describe("the Google OAuth redirect URI", () => {
  it("is localhost in dev, the public address in production, and an explicit value wins", () => {
    expect(redirectUri({})).toBe(DEFAULT_REDIRECT);
    expect(redirectUri({ SERENDIP_PUBLIC_URL: "https://serendip.fabriquefutur.com" })).toBe("https://serendip.fabriquefutur.com/api/youtube/callback");
    expect(redirectUri({ SERENDIP_PUBLIC_URL: "https://serendip.fabriquefutur.com/" })).toBe("https://serendip.fabriquefutur.com/api/youtube/callback");
    expect(redirectUri({ SERENDIP_PUBLIC_URL: "https://x.test", GOOGLE_OAUTH_REDIRECT_URI: "https://other.test/cb" })).toBe("https://other.test/cb");
  });
  it("flows into the OAuth config", () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret", SERENDIP_PUBLIC_URL: "https://serendip.fabriquefutur.com" };
    expect(oauthConfig(env)?.redirectUri).toBe("https://serendip.fabriquefutur.com/api/youtube/callback");
    expect(oauthConfig({ ...env, SERENDIP_PUBLIC_URL: "" })?.redirectUri).toBe(DEFAULT_REDIRECT);
  });
  it("knows which redirects need the Mac's own browser", () => {
    expect(isLocalRedirect("http://localhost:3000/api/youtube/callback")).toBe(true);
    expect(isLocalRedirect("http://127.0.0.1:3000/api/youtube/callback")).toBe(true);
    expect(isLocalRedirect("https://serendip.fabriquefutur.com/api/youtube/callback")).toBe(false);
    expect(isLocalRedirect("https://localhost.evil.test/cb")).toBe(false);
  });
  it("builds redirects on the public origin, not the container's bind address", () => {
    const req = new Request("http://0.0.0.0:3140/api/youtube/callback");
    expect(siteUrl(req, "/detour?yt=connected", { SERENDIP_PUBLIC_URL: "https://serendip.fabriquefutur.com" })).toBe("https://serendip.fabriquefutur.com/detour?yt=connected");
    expect(siteUrl(req, "/detour?yt=connected", {})).toBe("http://0.0.0.0:3140/detour?yt=connected");
  });
});
