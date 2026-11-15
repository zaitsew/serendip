# Serendip

Serendip finds films worth watching tonight, outside the loop a platform's recommender locked you
into. It works like zapping TV channels, not like a grid: one film per screen, a trailer already
playing, up and down to zap, left and right to change channel.

## Quick start

```
./setup.sh                        # install, create .env with a fresh SERENDIP_OWNER_KEY, say what is missing
npm run dev -- -H 0.0.0.0         # open http://localhost:3000 and sign in with the key
# optional, for the real catalog: put a free TMDB read token in .env (docs/GETTING-STARTED.md)
# pick services and loved films at /setup, then open /tv (or /tv?v=b for the second layout)
# on the TV (same Wi-Fi): http://<mac-ip>:3000/tv     ./check.sh = the gate     ./check.sh usage = counters
```

Without `SERENDIP_OWNER_KEY` the server refuses everything. Without `TMDB_READ_TOKEN` it runs on a
labelled sample catalog of 32 films, with a banner that says so.

## Status

Alpha, one owner. Sprint 1 ships:

- **Catalog**: TMDB (Spain availability, flat rate, cached 24 h) or a labelled sample catalog.
- **Setup** (`/setup`): services in Spain, languages, up to 15 loved films, optional disliked ones.
- **Imports**: Letterboxd export ZIP (taste seeds and seen) and Netflix ViewingActivity CSV (seen).
- **Ranking**: deterministic and unit-tested. No model. Every pick has a one-line reason.
- **Channels**: Tonight, Outside your usual, and themed ones built from the data.
- **Lean-back view** (`/tv`): D-pad remote and touch. Two layouts for review: `?v=a` and `?v=b`.
- **Evening log** (`/log`): what you watched, from where, how much you enjoyed it, minutes to choose.
- **Usage probe**: `./check.sh usage`.

Not yet: YouTube lane, deploy to a server, MCP/JSON for agents. See [docs/PRODUCT.md](docs/PRODUCT.md).

## What is here

| path | what |
|---|---|
| `app/`, `components/` | Next.js pages (`/tv`, `/setup`, `/log`) and `/api/*` |
| `src/core/` | pure ranking, "why" lines, title matching, the remote-control state machine |
| `src/catalog/` | TMDB client with SQLite cache; the sample fixture |
| `src/import/` | Letterboxd and Netflix import |
| `src/server/` | SQLite store (`node:sqlite`), owner key auth |
| `docs/` | product and roadmap, getting started |

Data lives in `data/serendip.db` (gitignored). Node 24 or newer.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
Availability data by JustWatch.

Licensed under Apache-2.0.
