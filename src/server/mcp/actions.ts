import { catalog } from "../../catalog";
import { store, type EveningSource } from "../store";
import { buildFeedView, clusterSummary, compactVideo, detourChannel, toTonight, type CompactVideo } from "../feedview";
import { ToolError } from "./tool";

/**
 * What the MCP tools do, in terms of the same store calls the /tv actions use (`/api/action`,
 * `/api/detour/action`, `/api/evening`). No ranking and no new rules live here.
 */

export type MarkAction = "seen" | "save" | "not_for_me";
const STORE_ACTION = { seen: "seen", save: "save", not_for_me: "dismiss" } as const;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FILM_ID = /^\d{1,9}$/;

export async function tonightForAgent() {
  const view = await buildFeedView();
  return toTonight(view, clusterSummary());
}

export async function channelForAgent(id: string) {
  const t = await tonightForAgent();
  const c = t.channels.find((x) => x.id === id);
  if (c) return { id: c.id, name: c.name, picks: c.picks };
  if (id === "detour" && t.detour) return { id: "detour", name: "Detour", picks: t.detour.picks };
  throw new ToolError("unknown_channel", `No channel "${id}". Channels: ${[...t.channels.map((x) => x.id), ...(t.detour ? ["detour"] : [])].join(", ") || "none yet (set up services at /setup)"}.`);
}

export async function detourForAgent(): Promise<{ cluster: string | null; picks: CompactVideo[]; note: string | null }> {
  const ch = await detourChannel();
  const cluster = clusterSummary();
  if (!ch) return { cluster, picks: [], note: "No Detour picks today." };
  // Without YOUTUBE_API_KEY the channel holds labelled placeholder cards, not videos.
  if (ch.picks.every((p) => p.sample)) return { cluster, picks: [], note: "This server has no YOUTUBE_API_KEY, so Detour has no real videos." };
  return { cluster, picks: ch.picks.map(compactVideo), note: null };
}

/** Marks a film (TMDB id, digits) or a Detour video (11-character YouTube id, one of today's picks). */
export async function markForAgent(id: string, action: MarkAction): Promise<{ ok: true; kind: "film" | "video"; id: string; action: MarkAction; title: string }> {
  const s = store();
  if (FILM_ID.test(id)) {
    const film = await catalog().film(Number(id));
    if (!film) throw new ToolError("not_found", `No film with id ${id}.`);
    s.act(film, STORE_ACTION[action]);
    return { ok: true, kind: "film", id, action, title: film.title };
  }
  if (VIDEO_ID.test(id)) {
    const pick = s.yt.getPicks()?.picks.find((p) => p.videoId === id);
    if (!pick) throw new ToolError("not_found", "That video is not in today's Detour.");
    s.yt.detourAct({ videoId: pick.videoId, action: STORE_ACTION[action], field: pick.field, channelId: pick.channelId, channelTitle: pick.channelTitle, title: pick.title });
    return { ok: true, kind: "video", id, action, title: pick.title };
  }
  throw new ToolError("invalid_id", "Send a film id (digits, from serendip_tonight) or an 11-character video id (from serendip_detour).");
}

/** The evening's calendar day in Spain, where the TV is. */
export const madridDay = (now: Date = new Date()): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function logEveningForAgent(a: { what: string; source: EveningSource; score: number | null; minutesToChoose: number | null; day?: string }): { ok: true; day: string } {
  const day = a.day ?? madridDay();
  store().logEvening({ day, watched: a.what, source: a.source, enjoyment: a.score, minutesToChoose: a.minutesToChoose });
  return { ok: true, day };
}
