// Prints key=value counters for `teyla products`: seeds, seen, picks_shown, opens, saves, dismissals,
// evenings_logged, last_open, and the S2 Detour counters (takeout_videos, detour_fields, detour_picks_shown,
// detour_watches, detour_dismissals, search_calls_today, youtube_connected). Zero is a finding, not an error. Reads SERENDIP_DB (default ./data/serendip.db).
import { existsSync } from "node:fs";
import { dbPath, openDb } from "../src/server/db";
import { createStore } from "../src/server/store";

const path = dbPath();
if (path !== ":memory:" && !existsSync(path)) {
  console.log("usage_probe=no_database_yet");
  for (const k of ["seeds", "seen", "picks_shown", "opens", "saves", "dismissals", "evenings_logged", "takeout_videos", "detour_fields", "detour_picks_shown", "detour_watches", "detour_dismissals", "search_calls_today", "youtube_connected"]) console.log(`${k}=0`);
  console.log("last_open=never");
} else {
  for (const [k, v] of Object.entries(createStore(openDb(path)).usage())) console.log(`${k}=${v}`);
}
