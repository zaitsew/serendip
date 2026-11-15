# Serendip — product and roadmap

Serendip finds films and videos worth watching tonight, outside the loop a platform's
recommender has locked you into. It works like zapping TV channels, not like a grid.

## The owner's words (2026-11-15, verbatim)

> Let's develop a film and video content recommendation platform. I noticed that Netflix,
> YouTube, Instagram, etc. have quite bad recommendation systems. For instance, I started
> scrolling TV channels with films to find good ones and it works better than Netflix. The
> same problem with YouTube - it built my recommendations around travel content and I
> cannot overcome it to see something interesting in other fields

Decisions in the kickoff session: name "Serendip", repo "zaitsew · public", primary
surface "Web: TV + iPhone" (one web app, lean-back view in the Xiaomi Google TV browser,
same page on the phone).

## Why zapping beats the Netflix grid

Second opinions from Grok 4.7 and GPT-6.1 Sol agreed on these mechanisms:

- A channel is a short list for a time slot. A grid ranks "will you keep watching".
- One title is on. You take it or you zap. An endless row makes choosing the work.
- You judge a minute of the film, not artwork optimised for the click.
- The next item is not "more like the last one". That rule is the YouTube travel trap.

Serves: "scrolling TV channels with films … works better than Netflix".

## What we can and cannot read (checked 2026-11-15)

| source | access | use |
|---|---|---|
| TMDB API | free, non-commercial, attribution | catalog, Spain availability (JustWatch data, attribution) |
| Netflix | no API; viewing-activity CSV from the account page | "already seen" import |
| Letterboxd | no API for personal apps; CSV ZIP export | taste seeds and seen list |
| YouTube Data API | free key, 10,000 units/day; search costs 100 units, so 12 a day here; playlists via OAuth; no history | Detour lane, write a playlist |
| Google Takeout | `watch-history.json` | find the cluster you are stuck in |
| Prime, Disney+, Movistar+, Filmin | no consumer API | link out only |
| Instagram | professional accounts only | out of scope |

No scraping. A charge for any source is a POLICY §11 question first.

## Roadmap

### S1 — Film channels on the web (this sprint)

Serves: "scrolling TV channels with films to find good ones".

- `/tv`: one film per screen, remote-friendly. Up/Down zap to the next or previous film (like
  channel buttons), Left/Right switch channel, 1 to 9 jump to a channel, OK opens the actions
  (Watch on the service, Save, Seen, Not for me), Back closes. On a phone: swipe up or down zaps,
  tap opens the actions. The trailer plays at once, muted, like landing on a channel mid-film.
  Two layouts for the owner to review on the device: `/tv?v=a` (full-bleed trailer, channel strip
  on top) and `/tv?v=b` (trailer left, info right, channel list at the bottom).
- Channels: "Tonight", "Outside your usual" and a few themed ones (country, decade, genre).
- Inputs: your services in Spain, languages, 15 loved films or a Letterboxd ZIP, the
  Netflix CSV as already seen.
- Ranking is deterministic: available tonight on your services, not seen, skip the most
  popular titles, a fixed share of slots outside your usual cluster. No LLM in S1.
- Every pick shows one line on why it is here, from a template.
- An evening log at `/log`: what you watched, from where (Serendip, Netflix home, TV zapping,
  other), a 1–5 score and minutes to choose. `/tv` asks about yesterday if it has no entry.
- Works without a TMDB key on a labelled fixture catalog, so the screen can be tried.

### S2 — The YouTube Detour lane (shipped)

Serves: "it built my recommendations around travel content and I cannot overcome it".

- **Takeout import** on `/setup`: `watch-history.json` (50 MB cap). Ads, YouTube Music, removed videos and
  non-watch rows are ignored; the HTML export gets a message that says to choose JSON.
- **Find the cluster.** With `YOUTUBE_API_KEY`: `videos.list` (topicDetails, snippet, contentDetails) on the
  latest 2,000 videos, 50 per call, at most 40 calls, cached in SQLite for good. A histogram of Wikipedia topic
  categories and YouTube categories: "Your last N videos: 62 % Travel, 14 % Food". Without a key: by channel.
- **Fields you want instead.** Up to 8 free-text fields, plus six suggested topic categories under 2 % of your history.
- **Daily Detour channel.** The first `/tv` or `/detour` open of the day (or `POST /api/detour/refresh`) runs
  `search.list` per field (medium, then long videos; at most `DAILY_SEARCH_BUDGET` = 12 calls per Pacific day,
  100 units each) and one `videos.list` per 50 candidates. Dropped: under 4 minutes, watched, top-30 channels,
  more than 50 % of topics inside the cluster, under 20k views or under 1.5 % likes. Deterministic score: like
  ratio, log views, freshness, minus a penalty per "Not for me" on the field. One video per channel; 12 kept, round-robin across fields.
- **On `/tv`:** channel "Detour" after "Tonight", same zapping. Muted youtube-nocookie preview; Watch plays full screen
  with sound. Why line: "Physics · away from Travel (62 % of your history)". Not for me mutes the channel for 90 days.
- **Optional playlist.** Google OAuth (authorization code, PKCE, scope `youtube`); refresh token in SQLite, AES-256-GCM
  under a key derived from `SERENDIP_OWNER_KEY`. A private "Serendip Detour" playlist is rewritten on each daily refresh
  (videos already in it stay; 50 units per insert or delete). The Connect step needs the Mac's browser (localhost redirect).
- **Sample mode:** no key means a banner "Sample — add YOUTUBE_API_KEY" and six labelled cards that do not play. Takeout still works.
- Official APIs only, no LLM, no invented video ids.

Not built, on purpose: any use of the YouTube watch history API (it does not exist), search without a key, Shorts.

### S3 — Live on the sofa

- Deploy to serendip.fabriquefutur.com on the droplet; bookmark in the TV browser.
- JSON + MCP so agents (and Loco evenings) can ask "what's on tonight".

### Later, only with a trigger

- Series, an LLM "programmer" that writes channel blurbs, Instagram (no API today).
- A Google TV app, only if week one shows fewer than 4 opens from the TV browser.

## Verdict test (no experiment ends without one)

Ten evenings, alternating Serendip, the Netflix home screen and broadcast zapping. Record
time to start, whether the pick was new to you, and enjoyment. Serendip continues only if
it wins on enjoyment without slowing the choice.
