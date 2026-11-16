import { z } from "zod";
import { MAX_TAKEOUT_VIDEOS, TAKEOUT_CHUNK_SIZE } from "../core/takeout";

/**
 * The compact Takeout payload the browser sends (see `compactTakeout` in src/core/takeout.ts). The server
 * never sees the raw file: it checks sizes and shapes here, then stages the rows.
 */

/** One chunk is at most 2,000 rows of about 400 bytes; 2 MB leaves room and still fits a 128 MB heap. */
export const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
/** Chunks are numbered from 0; this many cover MAX_TAKEOUT_VIDEOS. */
export const MAX_CHUNKS = Math.ceil(MAX_TAKEOUT_VIDEOS / TAKEOUT_CHUNK_SIZE);

const text = (max: number) => z.string().max(max);
const epoch = z.number().int().min(0).max(8_640_000_000_000_000);

export const WatchedRow = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: text(200),
  channel: text(120).nullable(),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{20,62}$/).nullable(),
  lastAt: epoch,
  plays: z.number().int().min(1).max(1_000_000),
}).strict();

const uploadId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const TakeoutChunk = z.object({
  phase: z.literal("chunk"),
  uploadId,
  index: z.number().int().min(0).max(MAX_CHUNKS - 1),
  videos: z.array(WatchedRow).min(1).max(TAKEOUT_CHUNK_SIZE),
}).strict();

const count = z.number().int().min(0).max(100_000_000);

export const TakeoutCommit = z.object({
  phase: z.literal("commit"),
  uploadId,
  rows: count,
  skipped: z.object({ ads: count, music: count, removed: count, other: count }).strict(),
}).strict();

export const TakeoutPayload = z.discriminatedUnion("phase", [TakeoutChunk, TakeoutCommit]);
export type TakeoutPayload = z.infer<typeof TakeoutPayload>;

export type Validated = { ok: true; payload: TakeoutPayload } | { ok: false; status: 400 | 413; error: string };

/** Size cap first (on the text, before any parse), then JSON, then the shape. */
export function validateTakeoutPayload(raw: string): Validated {
  if (raw.length > MAX_CHUNK_BYTES) return { ok: false, status: 413, error: "That chunk is larger than 2 MB." };
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return { ok: false, status: 400, error: "Body must be JSON." }; }
  const parsed = TakeoutPayload.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
  return { ok: true, payload: parsed.data };
}
