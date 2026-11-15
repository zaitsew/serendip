import { catalog } from "../../../src/catalog";
import { requireOwner } from "../../../src/server/auth";
import { fail, json } from "../../../src/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return json({ results: [] });
  try {
    const results = await catalog().search(q.slice(0, 100));
    return json({ results: results.map((r) => ({ id: r.id, title: r.title, year: r.year, genres: r.genres.slice(0, 2), poster: r.poster })) });
  } catch (e) {
    return fail(502, e instanceof Error ? e.message : "Catalog error.");
  }
}
