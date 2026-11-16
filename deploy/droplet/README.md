# Droplet deploy files

- `Dockerfile` builds the web image from the standalone Next output (see `scripts/deploy.sh`).
- `docker-compose.fragment.yml` holds one service, `serendip`, on port 3140 of the `apps` network, limited to
  200 MB of RAM and a 128 MB Node heap. There is no scheduler: the Detour refresh runs on the first open of the day.
- `Caddyfile.fragment` routes `serendip.fabriquefutur.com` to the container.
- `.env.example` is copied by `add-product.sh` to `/srv/serendip/.env` on the first run.

## Deploy

```
./scripts/deploy.sh --dry     # prints every step; builds and touches nothing
./scripts/deploy.sh           # build here, rsync to deploy@159.89.99.84, build the image there, wait for /api/v1/health
```

First run: the script calls `add-product.sh`, which writes the compose and Caddy files and an empty `.env`.
Put `SERENDIP_OWNER_KEY` in `/srv/serendip/.env` (`openssl rand -hex 24`), then
`ssh deploy@159.89.99.84 'cd /srv && docker compose up -d serendip'`. The deploy script never ships `data/*.db`,
`.env` or Takeout files, and stops if the bundle holds a native `*.node` module.

## Why the Takeout is parsed in the browser

A Takeout `watch-history.json` can be 50 MB. Parsing it on a 128 MB heap runs out of memory, so `/setup` reads
the file in the browser, keeps one compact row per video and sends 2,000 rows at a time (`docs/PRODUCT.md`, S3).

## Checks

- `curl https://serendip.fabriquefutur.com/api/v1/health` answers `{"ok":true,"version":"..."}` without a key.
- `ssh deploy@159.89.99.84 'docker stats --no-stream serendip'` shows memory under the 200 MB limit.
- Do not add a `log` directive to the Caddy block: `/mcp/<key>` carries the owner key in its path.
