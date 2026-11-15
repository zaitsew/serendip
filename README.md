# Serendip

Serendip finds films worth watching tonight, outside the loop a platform's recommender locked you
into. It works like zapping TV channels, not like a grid: one film per screen, a trailer already
playing, up and down to zap, left and right to change channel.

## Quick start

```
./setup.sh                        # install, create .env with a fresh SERENDIP_OWNER_KEY, say what is missing
npm run dev -- -H 0.0.0.0         # open http://localhost:3000 and sign in with the key
# optional, for the real catalog: put a free TMDB read token in .env (docs/GETTING-STARTED.md)
# optional, for Detour: YOUTUBE_API_KEY in .env, then upload watch-history.json at /setup and name fields at /detour
# pick services and loved films at /setup, then open /tv (or /tv?v=b for the second layout)
# on the TV (same Wi-Fi): http://<mac-ip>:3000/tv     ./check.sh = the gate     ./check.sh usage = counters
```

Without `SERENDIP_OWNER_KEY` the server refuses everything. Without `TMDB_READ_TOKEN` it runs on a
labelled sample catalog of 32 films, with a banner that says so.

## Status

Alpha, one owner. Sprints 1 and 2 ship:

- **Catalog**: TMDB (Spain availability, flat rate, cached 24 h) or a labelled sample catalog.
- **Setup** (`/setup`): services in Spain, languages, up to 15 loved films, optional disliked ones.
- **Imports**: Letterboxd export ZIP (taste seeds and seen) and Netflix ViewingActivity CSV (seen).
- **Ranking**: deterministic and unit-tested. No model. Every pick has a one-line reason.
- **Channels**: Tonight, Outside your usual, and themed ones built from the data.
- **Lean-back view** (`/tv`): D-pad remote and touch. Two layouts for review: `?v=a` and `?v=b`.
- **Evening log** (`/log`): what you watched, from where, how much you enjoyed it, minutes to choose.
- **Usage probe**: `./check.sh usage`.
- **Takeout import** (`/setup`): your YouTube `watch-history.json` (up to 50 MB). Ads, YouTube Music and removed videos are ignored.
- **The cluster** (`/setup`, `/detour`): "Your last 1,874 videos: 62 % Travel, 14 % Food" as a bar list. Topics need `YOUTUBE_API_KEY`; without it, by channel.
- **Detour** (`/detour`, channel "Detour" on `/tv`): you name up to 8 fields, or tick six suggestions under 2 % of your history.
  Once a day, up to 12 YouTube searches (hard cap) become 12 videos: no Shorts, nothing watched, none from your top-30 channels,
  nothing mostly inside your cluster, a quality floor, one per channel. Watch plays full screen (youtube-nocookie); Not for me mutes a channel for 90 days.
- **Playlist** (optional, `GOOGLE_OAUTH_CLIENT_ID` and `_SECRET`): a private "Serendip Detour" playlist in your YouTube account, rewritten daily, for the TV's YouTube app.
- **Sample mode**: without `YOUTUBE_API_KEY` Detour shows six labelled cards that do not play. No LLM anywhere; official Google APIs only.

Not yet: deploy to a server, MCP/JSON for agents. See [docs/PRODUCT.md](docs/PRODUCT.md).

## What is here

| path | what |
|---|---|
| `app/`, `components/` | Next.js pages (`/tv`, `/setup`, `/detour`, `/log`) and `/api/*` |
| `src/core/` | pure ranking, "why" lines, title matching, the remote-control state machine, Takeout parser, topic histogram, Detour filter and ranking |
| `src/youtube/` | YouTube Data API v3 client, Google OAuth with PKCE, the playlist calls |
| `src/catalog/` | TMDB client with SQLite cache; the sample fixture |
| `src/import/` | Letterboxd and Netflix import |
| `src/server/` | SQLite store (`node:sqlite`), owner key auth |
| `docs/` | product and roadmap, getting started |

Data lives in `data/serendip.db` (gitignored). Node 24 or newer.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
Availability data by JustWatch.

Licensed under Apache-2.0.
