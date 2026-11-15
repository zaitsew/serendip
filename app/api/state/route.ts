import { catalog } from "../../../src/catalog";
import { requireOwner } from "../../../src/server/auth";
import { fail, json } from "../../../src/server/http";
import { store } from "../../../src/server/store";

export const dynamic = "force-dynamic";

const brief = (f: { id: number; title: string; year: number | null }) => ({ id: f.id, title: f.title, year: f.year });

export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  try {
    const c = catalog();
    const s = store();
    return json({
      mode: c.mode,
      providers: await c.providers(),
      prefs: s.getPrefs(),
      configured: s.hasPrefs(),
      loved: s.marked("seed").filter((m) => m.source === "setup").map((m) => brief(m.film)),
      disliked: s.marked("dislike").map((m) => brief(m.film)),
      counts: s.counts(),
      unmatched: s.unmatched(),
    });
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Catalog error.");
  }
}
