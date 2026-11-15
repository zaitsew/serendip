#!/usr/bin/env bash
# The first-run check and the gate: prints what is missing, then runs the type check, lint and tests.
# The pre-push hook runs this; there is no GitHub Actions workflow on push or pull_request.
#
#   ./check.sh          full check
#   ./check.sh usage    real-usage counters (key=value), read by `teyla products`
set -uo pipefail
cd "$(dirname "$0")"

case "${1:-}" in
  usage)
    if [ -d node_modules ]; then
      npm run -s usage
    else
      echo "usage_probe=not_installed"
    fi
    exit 0 ;;
esac

missing=()
notes=()

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

[ -n "${SERENDIP_OWNER_KEY:-}" ] || missing+=("env: SERENDIP_OWNER_KEY (cp .env.example .env; generate one with: openssl rand -hex 24)")
[ -n "${YOUTUBE_API_KEY:-}" ] || notes+=("YOUTUBE_API_KEY is not set: Detour shows sample cards and the Takeout cluster is by channel only (unlocks topic clusters and real Detour videos)")
{ [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] && [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; } || notes+=("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not set: no 'Serendip Detour' playlist in your YouTube account (optional)")
[ -n "${TMDB_READ_TOKEN:-}" ] || notes+=("TMDB_READ_TOKEN is not set: Serendip runs on the sample catalog (see docs/GETTING-STARTED.md)")

if command -v node >/dev/null 2>&1; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || missing+=("toolchain: node >= 24 (found $(node -v)); node:sqlite needs it")
else
  missing+=("toolchain: node >= 24")
fi
command -v npm >/dev/null 2>&1 || missing+=("toolchain: npm")
[ -d node_modules ] || missing+=("run: npm install")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "MISSING:"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi

npx tsc --noEmit || { echo "typecheck FAILED"; exit 1; }
npx eslint . || { echo "lint FAILED"; exit 1; }
npx vitest run || { echo "tests FAILED"; exit 1; }

echo "OK"
for n in ${notes[@]+"${notes[@]}"}; do echo "  note: $n"; done
exit 0
