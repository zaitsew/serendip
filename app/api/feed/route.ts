import { catalog } from "../../../src/catalog";
import { watchUrl } from "../../../src/core/watch";
import { requireOwner } from "../../../src/server/auth";
import { fail, json } from "../../../src/server/http";
import { buildFeed } from "../../../src/server/service";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    const feed = await buildFeed(store(), catalog());
    return json({
      mode: feed.mode,
      needsSetup: feed.needsSetup,
      channels: feed.channels.map((c) => ({
        id: c.id,
        name: c.name,
        blurb: c.blurb,
        picks: c.picks.map((p) => ({
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
      })),
    });
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Could not build the channels.");
  }
}
