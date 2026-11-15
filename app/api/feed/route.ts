import { catalog } from "../../../src/catalog";
import { watchUrl } from "../../../src/core/watch";
import { requireOwner } from "../../../src/server/auth";
import { depsFromEnv, detourPicks, refreshDetour, type FeedVideo } from "../../../src/server/detour";
import { fail, json } from "../../../src/server/http";
import { buildFeed } from "../../../src/server/service";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const thumb = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

function detourPick(v: FeedVideo, sample: boolean) {
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
async function detourChannel() {
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

export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    const [feed, detour] = await Promise.all([buildFeed(store(), catalog()), detourChannel()]);
    const films = feed.channels.map((c) => ({
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
    // "Detour" sits right after "Tonight".
    const at = films.findIndex((c) => c.id === "tonight") + 1;
    const channels = detour ? [...films.slice(0, at), detour, ...films.slice(at)] : films;
    return json({ mode: feed.mode, needsSetup: feed.needsSetup && !detour, channels });
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Could not build the channels.");
  }
}
