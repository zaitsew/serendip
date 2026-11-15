/** Title matching for imports. Pure: given search candidates, pick the right film or none. */

export interface Candidate {
  id: number;
  title: string;
  originalTitle?: string;
  year: number | null;
  popularity?: number;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, "and").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The best result for a title and optional year, or null. Titles must match exactly after normalising. */
export function pickMatch(title: string, year: number | null, results: Candidate[]): Candidate | null {
  const want = norm(title);
  const hits = results.filter((r) => norm(r.title) === want || (r.originalTitle ? norm(r.originalTitle) === want : false));
  if (hits.length === 0) return null;
  if (year != null) {
    const close = hits.filter((r) => r.year != null && Math.abs(r.year - year) <= 1);
    if (close.length === 0) return null;
    return [...close].sort((a, b) => Math.abs((a.year ?? 0) - year) - Math.abs((b.year ?? 0) - year) || (b.popularity ?? 0) - (a.popularity ?? 0))[0] ?? null;
  }
  return [...hits].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0) || a.id - b.id)[0] ?? null;
}
