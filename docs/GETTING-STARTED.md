# Getting started

Serendip runs on a labelled sample catalog until you give it a TMDB token. Both paths work.

## 1. Install and start

```
./setup.sh                      # installs packages, writes .env with a fresh owner key
npm run dev -- -H 0.0.0.0       # listens on the Wi-Fi so the TV can reach it
```

Open `http://localhost:3000` and sign in with the key `setup.sh` printed (it is in `.env` as
`SERENDIP_OWNER_KEY`). Node 24 or newer is required.

## 2. Get a free TMDB read token (real catalog)

1. Create a free account at <https://www.themoviedb.org/signup>.
2. Open Settings, then API: <https://www.themoviedb.org/settings/api>.
3. Request an API key. Choose "Personal" use and fill in the short form.
4. Copy the **API Read Access Token** (the long one that starts with `eyJ`), not the short API key.
5. Put it in `.env` as `TMDB_READ_TOKEN=...` and restart the dev server.

The banner "Sample catalog — add TMDB_READ_TOKEN" disappears once the token works.
TMDB is free for personal, non-commercial use. Responses are cached for 24 hours in `data/serendip.db`.

## 3. Set up your taste

Open `/setup`:

- Tick your services in Spain.
- Tick the languages you watch in.
- Search and add up to 15 films you love. Add a few you disliked if you want.
- Optional: upload your Letterboxd export ZIP (Settings, Data, Export) and the Netflix
  `ViewingActivity.csv` (Account, Profile, Viewing activity, Download all).
  Unmatched titles are listed so you can see what was skipped.

## 4. Watch on the TV

1. Find your Mac's address: `ipconfig getifaddr en0`.
2. On the Xiaomi Google TV, open the browser and go to `http://<mac-ip>:3000/tv?v=a`.
3. Sign in once with the owner key (use the on-screen keyboard).
4. Keys: Up/Down next or previous film, Left/Right change channel, 1 to 9 jump to a channel,
   OK opens the actions (Watch, Save, Seen, Not for me), Back closes.

Try `?v=b` for the second layout. On an iPhone, open the same address: swipe up or down to zap,
swipe sideways to change channel, tap for the actions.

## 5. Log your evenings

Open `/log` (or answer the small prompt on `/tv`). Ten evenings are enough for the verdict test in
`docs/PRODUCT.md`.

## Check what is missing

```
./check.sh          # prints missing env vars or tools, then runs types, lint and tests
./check.sh usage    # counters: seeds, seen, picks_shown, opens, saves, dismissals, evenings_logged, last_open
```
