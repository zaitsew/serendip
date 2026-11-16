import { catalog } from "../catalog";
import { watchUrl } from "../core/watch";
import { clusterView, depsFromEnv, detourPicks, refreshDetour, type FeedVideo } from "./detour";
import { buildFeed } from "./service";
import { store } from "./store";

/**
 * What /api/feed, /api/v1/tonight and the MCP tools show. One builder, so a pick reads the same on the
 * TV, over JSON and from an agent. No ranking happens here: it maps what service.ts and detour.ts return.
 */

const thumb = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

export interface PickView {
  key: string;
  id: number;
  title: string;
  year: number | null;
  runtime: number | null;
  genres: string[];
  country: string | null;
  line: string;
  trailerKey: string | null;
  backdrop: string | null;
  poster: string | null;
  sample: boolean;
  why: string;
  outside: boolean;
  service: string;
  watchUrl: string;
  video?: { videoId: string | null; channel: string; field: string; placeholder: boolean };
}

export interface ChannelView { id: string; name: string; blurb: string; picks: PickView[] }
export interface FeedView { mode: "tmdb" | "sample"; needsSetup: boolean; channels: ChannelView[] }

function detourPick(v: FeedVideo, sample: boolean): PickView {
  const minutes = v.seconds ? Math.round(v.seconds / 60) : null;
  return {
    key: v.key,
    id: 0,
    title: v.title,
    year: null,
    runtime: minutes,
    genres: [v.field],
    country: null,
    line: [v.channel, v.views ? `${Intl.NumberFormat("en-US", { notation: "compact" }).format(v.views)} views` : null].filter(Boolean).join(" · "),
    trailerKey: null,
    backdrop: v.videoId ? thumb(v.videoId) : null,
    poster: null,
    sample,
    why: v.why,
    outside: true,
    service: "YouTube",
    watchUrl: v.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}` : "",
    video: { videoId: v.videoId, channel: v.channel, field: v.field, placeholder: v.placeholder },
  };
}

/** The Detour channel. A failure here never takes the film channels down. */
export async function detourChannel(): Promise<ChannelView | null> {
  const s = store();
  const deps = depsFromEnv();
  try { await refreshDetour(s, deps); } catch { /* the stored picks, if any, still show */ }
  const d = detourPicks(s, deps);
  if (d.picks.length === 0) return null;
  return {
    id: "detour",
    name: "Detour",
    blurb: d.sample ? "Sample, add YOUTUBE_API_KEY" : "Videos from fields outside your history",
    picks: d.picks.map((p) => detourPick(p, d.sample)),
  };
}

/** The film channels with Detour right after "Tonight". Throws when the catalog cannot answer. */
export async function buildFeedView(): Promise<FeedView> {
  const [feed, detour] = await Promise.all([buildFeed(store(), catalog()), detourChannel()]);
  const films: ChannelView[] = feed.channels.map((c) => ({
    id: c.id,
    name: c.name,
    blurb: c.blurb,
    picks: c.picks.map((p) => ({
      key: `f:${p.film.id}`,
      id: p.film.id,
      title: p.film.title,
      year: p.film.year,
      runtime: p.film.runtime,
      genres: p.film.genres.slice(0, 3),
      country: p.film.country,
      line: p.film.line,
      trailerKey: p.film.trailerKey,
      backdrop: p.film.backdrop,
      poster: p.film.poster,
      sample: !!p.film.sample,
      why: p.why,
      outside: p.outside,
      service: p.provider.name,
      watchUrl: watchUrl(p.film, p.provider),
    })),
  }));
  const at = films.findIndex((c) => c.id === "tonight") + 1;
  const channels = detour ? [...films.slice(0, at), detour, ...films.slice(at)] : films;
  return { mode: feed.mode, needsSetup: feed.needsSetup && !detour, channels };
}

// --- The compact form for JSON and MCP ------------------------------------------------------------

export interface CompactFilm {
  id: number;
  title: string;
  year: number | null;
  runtimeMin: number | null;
  service: string;
  watchUrl: string;
  why: string;
  trailerKey: string | null;
  sample?: true;
}
export interface CompactVideo {
  videoId: string | null;
  title: string;
  channel: string;
  field: string;
  minutes: number | null;
  why: string;
  url: string;
  sample?: true;
}
export interface Tonight {
  catalog: "tmdb" | "sample";
  needsSetup: boolean;
  /** Where to watch is for Spain (ES). */
  region: "ES";
  channels: Array<{ id: string; name: string; picks: CompactFilm[] }>;
  detour: { cluster: string | null; picks: CompactVideo[] } | null;
}

const compactFilm = (p: PickView): CompactFilm => ({
  id: p.id, title: p.title, year: p.year, runtimeMin: p.runtime, service: p.service, watchUrl: p.watchUrl, why: p.why, trailerKey: p.trailerKey,
  ...(p.sample ? { sample: true as const } : {}),
});

export const compactVideo = (p: PickView): CompactVideo => ({
  videoId: p.video?.videoId ?? null, title: p.title, channel: p.video?.channel ?? "", field: p.video?.field ?? "", minutes: p.runtime, why: p.why, url: p.watchUrl,
  ...(p.sample ? { sample: true as const } : {}),
});

/** The cluster line, e.g. "Your last 1,874 videos: 62 % Travel, 14 % Food"; null before a Takeout import. */
export function clusterSummary(): string | null {
  return clusterView(store(), !!depsFromEnv().yt).headline;
}

export function toTonight(view: FeedView, cluster: string | null): Tonight {
  const films = view.channels.filter((c) => c.id !== "detour");
  const detour = view.channels.find((c) => c.id === "detour");
  return {
    catalog: view.mode,
    needsSetup: view.needsSetup,
    region: "ES",
    channels: films.map((c) => ({ id: c.id, name: c.name, picks: c.picks.map(compactFilm) })),
    // Sample cards (no YouTube key) are labelled placeholders for the TV, not videos: an agent never sees them.
    detour: detour && !detour.picks.every((p) => p.sample) ? { cluster, picks: detour.picks.map(compactVideo) } : null,
  };
}

export async function tonight(): Promise<Tonight> {
  return toTonight(await buildFeedView(), clusterSummary());
}
