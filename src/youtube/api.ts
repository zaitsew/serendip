/**
 * YouTube Data API v3, official endpoints only, through `fetch`. The key goes in the query string
 * (that is how the API takes it), so errors never carry the URL.
 */
import type { Candidate, Duration } from "../core/detour";
import type { VideoMeta } from "../core/topics";

const BASE = "https://www.googleapis.com/youtube/v3";

export class YoutubeError extends Error {
  constructor(readonly status: number, readonly reason: string, message: string) {
    super(message);
    this.name = "YoutubeError";
  }
  get quota() { return this.reason === "quotaExceeded" || this.reason === "rateLimitExceeded" || this.reason === "dailyLimitExceeded"; }
}

export type FetchFn = typeof fetch;

/** ISO 8601 duration ("PT1H2M3S", "P1DT2H") to seconds. Live streams ("P0D") give 0. */
export function parseDuration(iso: string | undefined): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

interface RawVideo {
  id?: string;
  snippet?: { categoryId?: string; channelId?: string; channelTitle?: string; title?: string; publishedAt?: string };
  contentDetails?: { duration?: string };
  topicDetails?: { topicCategories?: string[] };
  statistics?: { viewCount?: string; likeCount?: string };
}

export interface SearchHit { videoId: string; title: string; channelId: string | null; channelTitle: string; publishedAt: string }

export interface VideoDetail extends VideoMeta {
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
}

export interface YoutubeClient {
  /** videos.list for up to 50 ids. Ids the API does not return come back with found = false. */
  videos(ids: string[], parts: Array<"snippet" | "contentDetails" | "topicDetails" | "statistics">): Promise<VideoDetail[]>;
  search(opts: { q: string; duration: Duration; language: string | null; publishedAfter: string }): Promise<SearchHit[]>;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

async function call(f: FetchFn, path: string, params: Record<string, string>, key: string): Promise<unknown> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
  let res: Response;
  try { res = await f(url, { headers: { accept: "application/json" } }); } catch { throw new YoutubeError(0, "network", "Could not reach the YouTube API."); }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason ?? `http${res.status}`;
    throw new YoutubeError(res.status, reason, `YouTube API ${res.status} (${reason}).`);
  }
  return body;
}

export function createYoutube(opts: { key: string; fetch?: FetchFn }): YoutubeClient {
  const f = opts.fetch ?? fetch;
  return {
    async videos(ids, parts) {
      const clean = ids.filter((i) => VIDEO_ID.test(i)).slice(0, 50);
      if (clean.length === 0) return [];
      const body = (await call(f, "videos", { part: parts.join(","), id: clean.join(","), maxResults: "50" }, opts.key)) as { items?: RawVideo[] };
      const got = new Map((body.items ?? []).filter((v): v is RawVideo & { id: string } => typeof v.id === "string").map((v) => [v.id, v]));
      return clean.map((id): VideoDetail => {
        const v = got.get(id);
        if (!v) return { videoId: id, found: false, categoryId: null, topics: [], channelId: null, channelTitle: null, title: null, seconds: null, publishedAt: null, views: null, likes: null };
        return {
          videoId: id,
          found: true,
          categoryId: v.snippet?.categoryId ?? null,
          topics: v.topicDetails?.topicCategories ?? [],
          channelId: v.snippet?.channelId ?? null,
          channelTitle: v.snippet?.channelTitle ?? null,
          title: v.snippet?.title ?? null,
          seconds: v.contentDetails?.duration ? parseDuration(v.contentDetails.duration) : null,
          publishedAt: v.snippet?.publishedAt ?? null,
          views: v.statistics?.viewCount !== undefined ? Number(v.statistics.viewCount) : null,
          likes: v.statistics?.likeCount !== undefined ? Number(v.statistics.likeCount) : null,
        };
      });
    },
    async search({ q, duration, language, publishedAfter }) {
      const params: Record<string, string> = {
        part: "snippet", type: "video", q, videoDuration: duration, safeSearch: "moderate", order: "relevance",
        videoEmbeddable: "true", maxResults: "50", publishedAfter,
      };
      if (language) params.relevanceLanguage = language;
      const body = (await call(f, "search", params, opts.key)) as { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string } }> };
      const hits: SearchHit[] = [];
      for (const it of body.items ?? []) {
        const id = it.id?.videoId;
        if (!id || !VIDEO_ID.test(id)) continue;
        hits.push({ videoId: id, title: it.snippet?.title ?? "", channelId: it.snippet?.channelId ?? null, channelTitle: it.snippet?.channelTitle ?? "", publishedAt: it.snippet?.publishedAt ?? "" });
      }
      return hits;
    },
  };
}

export const youtubeKey = (env: Record<string, string | undefined> = process.env): string | null => env.YOUTUBE_API_KEY?.trim() || null;

/** A search hit joined with its videos.list details becomes a Candidate; hits without stats or a duration are dropped. */
export function toCandidate(hit: SearchHit, d: VideoDetail, field: string): Candidate | null {
  if (!d.found || d.seconds === null || d.views === null) return null;
  return {
    videoId: hit.videoId,
    title: (d.title ?? hit.title).slice(0, 200),
    channelId: d.channelId ?? hit.channelId,
    channelTitle: d.channelTitle ?? hit.channelTitle,
    field,
    publishedAt: d.publishedAt ?? hit.publishedAt,
    seconds: d.seconds,
    views: d.views,
    likes: d.likes,
    topics: d.topics,
  };
}
