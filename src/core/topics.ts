/**
 * Topic clusters from YouTube metadata. Pure and deterministic.
 *
 * `topicDetails.topicCategories` are Wikipedia URLs; `snippet.categoryId` is YouTube's own category.
 * A video counts once per topic, so shares can add up to more than 100 %.
 */

export interface VideoMeta {
  videoId: string;
  /** False when the API did not return the video (private, deleted). Cached so we never ask twice. */
  found: boolean;
  categoryId: string | null;
  topics: string[]; // Wikipedia URLs
  channelId: string | null;
  channelTitle: string | null;
  title: string | null;
  seconds: number | null;
}

export const CATEGORY_NAMES: Record<string, string> = {
  "1": "Film & Animation", "2": "Autos & Vehicles", "10": "Music", "15": "Pets & Animals", "17": "Sports", "18": "Short Movies",
  "19": "Travel & Events", "20": "Gaming", "21": "Videoblogging", "22": "People & Blogs", "23": "Comedy", "24": "Entertainment",
  "25": "News & Politics", "26": "Howto & Style", "27": "Education", "28": "Science & Technology", "29": "Nonprofits & Activism",
  "30": "Movies", "31": "Anime/Animation", "32": "Action/Adventure", "33": "Classics", "34": "Comedy", "35": "Documentary", "36": "Drama",
  "37": "Family", "38": "Foreign", "39": "Horror", "40": "Sci-Fi/Fantasy", "41": "Thriller", "42": "Shorts", "43": "Shows", "44": "Trailers",
};

/** Where a Wikipedia title reads oddly, say it the way a person would. */
const LABEL_OVERRIDES: Record<string, string> = {
  Tourism: "Travel",
  "Lifestyle (sociology)": "Lifestyle",
  "Physical attractiveness": "Beauty",
  "Physical fitness": "Fitness",
  "Television program": "Television",
  "Role-playing video game": "Role-playing games",
  "Video game culture": "Gaming culture",
  Humour: "Humor",
};

/** The top-level YouTube topics. They tag almost everything, so they never define a cluster. */
export const PARENT_TOPICS = new Set(["Music", "Gaming", "Sports", "Sport", "Entertainment", "Lifestyle", "Society", "Knowledge"]);

export function topicLabel(url: string): string {
  let last = url;
  try { last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url); } catch { /* keep the raw text */ }
  const name = last.replace(/_/g, " ").trim();
  return LABEL_OVERRIDES[name] ?? name;
}

export interface Bar { label: string; count: number; share: number }

export interface Histogram {
  /** Videos that had metadata. */
  total: number;
  topics: Bar[];
  categories: Bar[];
}

function bars(counts: Map<string, number>, total: number): Bar[] {
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function topicHistogram(metas: VideoMeta[]): Histogram {
  const found = metas.filter((m) => m.found);
  const topics = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const m of found) {
    for (const label of new Set(m.topics.map(topicLabel))) topics.set(label, (topics.get(label) ?? 0) + 1);
    if (m.categoryId) {
      const name = CATEGORY_NAMES[m.categoryId] ?? `Category ${m.categoryId}`;
      cats.set(name, (cats.get(name) ?? 0) + 1);
    }
  }
  return { total: found.length, topics: bars(topics, found.length), categories: bars(cats, found.length) };
}

export interface ChannelBar { channel: string; count: number; share: number }

/** The no-key fallback: clusters by channel only. `rows` are (channel, plays) pairs. */
export function channelHistogram(rows: Array<{ channel: string | null; plays: number }>): { total: number; channels: ChannelBar[] } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (!r.channel) continue;
    total += r.plays;
    counts.set(r.channel, (counts.get(r.channel) ?? 0) + r.plays);
  }
  const channels = [...counts.entries()].map(([channel, count]) => ({ channel, count, share: total ? count / total : 0 })).sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));
  return { total, channels };
}

export const CLUSTER = { size: 3, minShare: 0.1 } as const;

/** The main cluster: the biggest non-generic topics that cover at least a tenth of the history. */
export function mainCluster(h: Histogram): Bar[] {
  return h.topics.filter((t) => !PARENT_TOPICS.has(t.label) && t.share >= CLUSTER.minShare).slice(0, CLUSTER.size);
}

/** Share of a video's specific topics that sit inside the cluster; 0 when it has none. */
export function clusterOverlap(topics: string[], cluster: Set<string>): number {
  const labels = [...new Set(topics.map(topicLabel))].filter((l) => !PARENT_TOPICS.has(l));
  if (labels.length === 0) return 0;
  return labels.filter((l) => cluster.has(l)).length / labels.length;
}

export interface Suggestion { label: string; query: string; group: string }

/** Fields a person might want instead. Order matters: it breaks ties. `label` must match topicLabel(). */
export const SUGGESTIONS: Suggestion[] = [
  { label: "Classical music", query: "classical music", group: "Music" },
  { label: "Jazz", query: "jazz history", group: "Music" },
  { label: "Film", query: "film analysis", group: "Entertainment" },
  { label: "Performing arts", query: "theatre and dance", group: "Entertainment" },
  { label: "Technology", query: "how technology works", group: "Lifestyle" },
  { label: "Hobby", query: "craft and making", group: "Lifestyle" },
  { label: "Food", query: "food science", group: "Lifestyle" },
  { label: "Fashion", query: "fashion history", group: "Lifestyle" },
  { label: "Vehicle", query: "engineering of vehicles", group: "Lifestyle" },
  { label: "Pet", query: "animal behaviour", group: "Lifestyle" },
  { label: "Business", query: "business case studies", group: "Society" },
  { label: "Politics", query: "political economy", group: "Society" },
  { label: "Military", query: "military history", group: "Society" },
  { label: "Religion", query: "history of religion", group: "Society" },
  { label: "Health", query: "health and medicine explained", group: "Society" },
  { label: "Knowledge", query: "science explained", group: "Knowledge" },
  { label: "Humor", query: "stand-up comedy", group: "Entertainment" },
  { label: "Fitness", query: "sports science", group: "Lifestyle" },
];

export const SUGGEST_BELOW = 0.02;
export const SUGGEST_COUNT = 6;
const PER_GROUP = 2;

export interface ScoredSuggestion extends Suggestion { share: number | null }

/**
 * Six topic categories under 2 % of the history, rarest first, at most two per group so the list
 * spreads. With no topic data (no API key) every share is unknown and the list order decides.
 */
export function suggestFields(h: Histogram | null, exclude: string[] = []): ScoredSuggestion[] {
  const known = h && h.total > 0 ? new Map(h.topics.map((t) => [t.label, t.share])) : null;
  const taken = new Set(exclude.map((e) => e.toLowerCase()));
  const pool = SUGGESTIONS
    .map((s, order) => ({ s, order, share: known ? (known.get(s.label) ?? 0) : null }))
    .filter((x) => (x.share === null || x.share < SUGGEST_BELOW) && !taken.has(x.s.query.toLowerCase()))
    .sort((a, b) => (a.share ?? 0) - (b.share ?? 0) || a.order - b.order);
  const perGroup = new Map<string, number>();
  const out: ScoredSuggestion[] = [];
  for (const x of pool) {
    const n = perGroup.get(x.s.group) ?? 0;
    if (n >= PER_GROUP) continue;
    perGroup.set(x.s.group, n + 1);
    out.push({ ...x.s, share: x.share });
    if (out.length === SUGGEST_COUNT) break;
  }
  return out;
}

export const percent = (share: number) => `${Math.round(share * 100)} %`;
