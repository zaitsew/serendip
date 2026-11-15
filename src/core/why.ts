import type { Film, Provider } from "./types";
import type { Histograms } from "./rank";

const THE = new Set(["US", "GB", "SU", "NL"]);

const COUNTRIES: Record<string, string> = {
  US: "United States", GB: "United Kingdom", FR: "France", DE: "Germany", IT: "Italy", ES: "Spain", JP: "Japan", KR: "South Korea",
  CN: "China", HK: "Hong Kong", TW: "Taiwan", IN: "India", MX: "Mexico", AR: "Argentina", BR: "Brazil", CO: "Colombia", CL: "Chile", PL: "Poland",
  SU: "Soviet Union", RU: "Russia", SE: "Sweden", DK: "Denmark", NO: "Norway", FI: "Finland", IR: "Iran", TR: "Turkey", GR: "Greece",
  CA: "Canada", AU: "Australia", NL: "Netherlands", BE: "Belgium", PT: "Portugal", AT: "Austria", CH: "Switzerland", IE: "Ireland",
  CZ: "Czechia", HU: "Hungary", RO: "Romania", UA: "Ukraine", IL: "Israel", EG: "Egypt", ZA: "South Africa", NG: "Nigeria", TH: "Thailand",
};

export function countryName(code: string): string {
  return COUNTRIES[code] ?? code;
}

/** "United States" in running text, "Japan" where no article is needed. */
export function countryPhrase(code: string): string {
  const name = countryName(code);
  return THE.has(code) ? `the ${name}` : name;
}

export function decadeLabel(decade: number): string {
  return `${decade}s`;
}

/** 116 -> "1 h 56", 45 -> "45 min", null -> "length unknown". */
export function formatRuntime(minutes: number | null): string {
  if (minutes == null || minutes <= 0) return "length unknown";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

function topKey<K>(m: Map<K, number>): K | null {
  let best: K | null = null;
  let v = -1;
  for (const [k, n] of m) if (n > v) { best = k; v = n; }
  return best;
}

export interface WhyInput {
  film: Film;
  because: Film | null;
  outside: boolean;
  provider: Provider;
  hist: Histograms;
}

/** One line from fixed templates: "Because you loved Arrival · Filmin · 1 h 56". No model writes it. */
export function whyLine({ film, because, outside, provider, hist }: WhyInput): string {
  const tail = `${provider.name} · ${formatRuntime(film.runtime)}`;
  if (because) return `Because you loved ${because.title} · ${tail}`;
  if (outside) {
    const usual = topKey(hist.country);
    const from = film.country && film.country !== usual ? `${countryPhrase(film.country)}` : (film.genres[0] ?? "a new corner");
    const base = usual && hist.total > 0 ? `Outside your usual: ${from}, you mostly watch ${countryPhrase(usual)}` : `A stranger: ${from}`;
    return `${base} · ${tail}`;
  }
  const shared = film.genres.find((g) => (hist.genre.get(g) ?? 0) > 0);
  if (shared) return `Close to your taste in ${shared} · ${tail}`;
  return `Well rated, and not on everyone's list · ${tail}`;
}
