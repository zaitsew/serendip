#!/usr/bin/env bash
# First run: installs packages, creates .env with a fresh owner key, and says what is still missing.
#
#   ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "Serendip needs Node 24 or newer (it uses node:sqlite). Install it, then run ./setup.sh again."
  exit 1
fi

[ -d node_modules ] || npm install

if [ ! -f .env ]; then
  cp .env.example .env
  key="$(openssl rand -hex 24)"
  sed -i.bak "s/^SERENDIP_OWNER_KEY=.*/SERENDIP_OWNER_KEY=$key/" .env && rm -f .env.bak
  echo "Created .env with a new owner key. You sign in with it:"
  echo "  $key"
fi

ip="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo
./check.sh usage | head -3 || true
echo
echo "Start it:   npm run dev -- -H 0.0.0.0"
echo "On this Mac: http://localhost:3000/tv"
[ -n "$ip" ] && echo "On the TV:   http://$ip:3000/tv   (same Wi-Fi)"
grep -q '^TMDB_READ_TOKEN=.\+' .env || echo "Note: no TMDB_READ_TOKEN yet, so you get the sample catalog. See docs/GETTING-STARTED.md."
if ! grep -q '^YOUTUBE_API_KEY=.\+' .env; then
  echo "Note: no YOUTUBE_API_KEY yet. /detour and the Detour channel show labelled sample cards, and the Takeout cluster is by channel only. Unlocks: topic clusters and real Detour videos. See docs/GETTING-STARTED.md, step 5."
fi
if ! grep -q '^GOOGLE_OAUTH_CLIENT_ID=.\+' .env || ! grep -q '^GOOGLE_OAUTH_CLIENT_SECRET=.\+' .env; then
  echo "Note: no Google OAuth client (GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET). Optional. Unlocks: a private \"Serendip Detour\" playlist you can play in the TV's YouTube app. See docs/GETTING-STARTED.md, step 6."
fi
echo "Takeout: upload watch-history.json at /setup to see the cluster you are stuck in (docs/GETTING-STARTED.md, step 4)."
