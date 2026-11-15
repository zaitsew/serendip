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
| YouTube Data API | search ~100 calls/day; playlists via OAuth; no history | Detour lane, write a playlist |
| Google Takeout | `watch-history.json` | find the cluster you are stuck in |
| Prime, Disney+, Movistar+, Filmin | no consumer API | link out only |
| Instagram | professional accounts only | out of scope |

No scraping. A charge for any source is a POLICY §11 question first.

## Roadmap

### S1 — Film channels on the web (this sprint)

Serves: "scrolling TV channels with films to find good ones".

- `/tv`: one film per screen, remote-friendly. Left/right zaps, OK opens, up saves, down
  says "seen / not for me". The trailer plays at once, like landing on a channel mid-film.
- Channels: "Tonight", "Outside your usual" and a few themed ones (country, decade, genre).
- Inputs: your services in Spain, languages, 15 loved films or a Letterboxd ZIP, the
  Netflix CSV as already seen.
- Ranking is deterministic: available tonight on your services, not seen, skip the most
  popular titles, a fixed share of slots outside your usual cluster. No LLM in S1.
- Every pick shows one line on why it is here.
- An evening log: what you watched, from where (Serendip, Netflix, TV), and a 1–5 score.
- Works without a TMDB key on a labelled fixture catalog, so the screen can be tried.

### S2 — The YouTube Detour lane

Serves: "it built my recommendations around travel content and I cannot overcome it".

- Import Takeout watch history; show the clusters you are stuck in.
- You name fields you want instead. Logged-out search finds videos there.
- A daily "Serendip" playlist written to your YouTube account, so it plays in the TV's
  YouTube app with no new client (the Mixtape pattern).

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
