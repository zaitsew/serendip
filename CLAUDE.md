# serendip — agent guide

One line: Serendip finds films worth watching tonight, outside the loop a platform's recommender locked
you into. A web app: `/tv` is a lean-back, remote-driven screen of channels; the same page works on an iPhone.

Read first: `docs/PRODUCT.md` (the owner's words, data sources, roadmap).

Hard rules:
- No scraping, ever. Data comes from the TMDB API (cached 24 h) or the labelled sample catalog. YouTube: the Data API v3 and Google OAuth only (no ytmusicapi, no internal endpoints). Never invent a video id.
- No LLM. Ranking (`src/core/rank.ts`) and Detour (`src/core/detour.ts`, `topics.ts`) are pure and deterministic; every "why" line is a template. Search budget: `DAILY_SEARCH_BUDGET` = 12 a day.
- Never copy TMDB or Wikipedia overviews. Sample films carry our own one-liners.
- The repo is public: no keys, no personal data. Those live in `.env` and `data/serendip.db` (both gitignored).
- Everything in the repo is in English. Attribution stays in the footer and on `/tv`.
- Features land on the primary platform (web) first; see `teyla.toml`.

## How to run / check it

```
./setup.sh        # first run: install, .env with a fresh key, what is missing
./check.sh        # typecheck + lint + tests: the gate (no CI on push)
./check.sh usage  # key=value counters
```

## Layout

| path | what |
|---|---|
| `src/core/` | pure code: ranking, why lines, matching, the remote-control state machine (`zap.ts`), Takeout parser, topics, Detour filter and ranking |
| `src/catalog/` | TMDB client with SQLite cache, the sample fixture, one `Catalog` interface |
| `src/youtube/` | YouTube Data API v3 client and Google OAuth (PKCE) with the playlist calls; every function takes `fetch` |
| `src/import/` | Letterboxd ZIP, Netflix CSV, a small CSV and ZIP reader |
| `src/server/` | SQLite (`node:sqlite`), store, owner auth, the glue in `service.ts` |
| `app/` | pages (`/tv`, `/setup`, `/detour`, `/log`, `/signin`) and `/api/*` routes |
| `components/` | `TvApp` (both layout variants), `SetupForm`, `LogForm` |

Shipping: open the PR and stop unless this repo is named on the merge-approved list in `~/.claude/CLAUDE.md`.
One PR per logical unit, merge not squash, never force-push.
Shared session policy for every harness: `~/.agents/POLICY.md`.
