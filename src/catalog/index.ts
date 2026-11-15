import { db } from "../server/db";
import { createSample } from "./sample";
import { createTmdb } from "./tmdb";
import type { Catalog } from "./types";

export type { Catalog, SearchHit } from "./types";

export function tmdbToken(env: Record<string, string | undefined> = process.env): string | null {
  return env.TMDB_READ_TOKEN?.trim() || null;
}

const g = globalThis as unknown as { __serendipCatalog?: { token: string | null; catalog: Catalog } };

/** The TMDB catalog when TMDB_READ_TOKEN is set, otherwise the labelled sample catalog. */
export function catalog(): Catalog {
  const token = tmdbToken();
  if (g.__serendipCatalog?.token === token) return g.__serendipCatalog.catalog;
  const c = token ? createTmdb({ token, db: db() }) : createSample();
  g.__serendipCatalog = { token, catalog: c };
  return c;
}
