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
