# Getting started

Serendip runs on a labelled sample catalog until you give it a TMDB token, and shows labelled sample Detour cards
until you give it a YouTube key. Both paths work.

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

## 4. Find your cluster with Google Takeout (S2)

Serendip cannot read your YouTube history through any API, so you hand it a file.

1. Open <https://takeout.google.com>.
2. Press **Deselect all**.
3. Tick **YouTube and YouTube Music**.
4. Press **All YouTube data included**, deselect everything, and tick only **history**.
5. Press **Multiple formats** and set the history format to **JSON** (the default is HTML, which Serendip refuses with a message).
6. Create the export, download the ZIP, and take `watch-history.json` out of it (`Takeout/YouTube and YouTube Music/history/`).
7. Open `/setup`, find "YouTube watch history (Takeout)" and upload the file (up to 50 MB).

Ads, YouTube Music entries and removed videos are ignored. Without a YouTube key you get a cluster by
channel only; step 5 below adds topics ("Your last 1,874 videos: 62 % Travel, 14 % Food").
The file stays on your machine, in `data/serendip.db` (gitignored).

## 5. Get a free YouTube API key (topics and real Detour videos)

1. Open <https://console.cloud.google.com> and create a new project (any name).
2. Open APIs and Services, Library, search **YouTube Data API v3** and press Enable.
3. Open APIs and Services, Credentials, Create credentials, **API key**.
4. Edit the key: under API restrictions choose **Restrict key** and tick only **YouTube Data API v3**. Save.
5. Put it in `.env` as `YOUTUBE_API_KEY=...` and restart the dev server.

The key is free with 10,000 quota units a day. Serendip spends: 1 unit per 50 videos read for the cluster
(at most 40 calls for the last 2,000 videos, once, cached forever), and 100 units per search. Searches are capped
at 12 a day (`DAILY_SEARCH_BUDGET`), so a day costs at most about 1,300 units, plus 50 per playlist change.
The banner "Sample — add YOUTUBE_API_KEY" disappears on `/detour` once the key works.

Then on `/detour`: name up to 8 fields you want instead ("physics", "architecture history") or tick the six
suggestions under 2 % of your history, and press Refresh now. The Detour channel on `/tv` sits after "Tonight".
Each day's first `/tv` or `/detour` open refreshes it by itself.

## 6. Optional: a "Serendip Detour" playlist in your YouTube account

This puts today's 12 videos into a private playlist, so the TV's YouTube app can play them. It needs an OAuth client.

1. In the same Google Cloud project open APIs and Services, **OAuth consent screen** (Google Auth platform).
2. Choose user type **External**. Fill in the app name and your email. Keep **Testing** as the publishing status.
3. Under **Test users** add your own Google account. (Testing mode refresh tokens last 7 days; connect again when it says so.)
4. Open Credentials, Create credentials, **OAuth client ID**, application type **Web application**.
5. Under Authorized redirect URIs add exactly `http://localhost:3000/api/youtube/callback`.
6. Put the client ID and secret in `.env` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, restart.
7. **On the Mac itself**, open `http://localhost:3000/detour` and press **Connect YouTube**. This one step must be done
   from the Mac's browser: Google refuses a LAN IP address like `http://192.168.1.20:3000` as the redirect, and the
   sign-in cookie is tied to the address you opened.
8. Approve the YouTube permission. Press Refresh now; the playlist appears in your YouTube library.

The refresh token is stored in SQLite, encrypted with AES-256-GCM under a key derived from `SERENDIP_OWNER_KEY`.
Changing the owner key makes it unreadable: connect again. **Disconnect YouTube** on `/detour` revokes it at Google and
deletes it here. Each playlist change costs 50 quota units.

## 7. Watch on the TV

1. Find your Mac's address: `ipconfig getifaddr en0`.
2. On the Xiaomi Google TV, open the browser and go to `http://<mac-ip>:3000/tv?v=a`.
3. Sign in once with the owner key (use the on-screen keyboard).
4. Keys: Up/Down next or previous film, Left/Right change channel, 1 to 9 jump to a channel,
   OK opens the actions (Watch, Save, Seen, Not for me), Back closes.
5. On the Detour channel, Watch plays the video full screen in the page with sound (Back closes it), and
   Not for me mutes that channel for 90 days and lowers that field.

Try `?v=b` for the second layout. On an iPhone, open the same address: swipe up or down to zap,
swipe sideways to change channel, tap for the actions.

## 8. Log your evenings

Open `/log` (or answer the small prompt on `/tv`). Ten evenings are enough for the verdict test in
`docs/PRODUCT.md`.

## Check what is missing

```
./check.sh          # prints missing env vars or tools, then runs types, lint and tests
./check.sh usage    # counters: seeds, seen, picks_shown, opens, saves, dismissals, evenings_logged, last_open,
                    # takeout_videos, detour_fields, detour_picks_shown, detour_watches, detour_dismissals,
                    # search_calls_today, youtube_connected
```
