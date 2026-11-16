# Serendip web, for the small shared server.
#
# The image is not built from source. The droplet has 1 GB of RAM and cannot run `next build`, so
# scripts/deploy.sh builds on the laptop, assembles Next's standalone output into dist/droplet/app/
# (server.js, .next/static, public, a pruned node_modules) and rsyncs it to /srv/serendip/app/. This file
# is copied into that directory and is the whole build: one COPY, no compiler, no native modules (the
# database is Node's built-in node:sqlite, which needs Node 24 or newer).
#
#   docker build --platform linux/amd64 -t serendip-web dist/droplet/app

FROM node:24-alpine

# Lets deploy.sh prune old Serendip images without touching another product's.
LABEL app=serendip

WORKDIR /app
# 3140 is Serendip's port on the shared `apps` network; no other product uses it.
# The heap cap is 128 MB because the container is limited to 200 MB (the box is short on RAM).
ENV NODE_ENV=production \
    PORT=3140 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    SERENDIP_DB=/data/serendip.db \
    NODE_OPTIONS="--max-old-space-size=128 --disable-warning=ExperimentalWarning"

COPY --chown=node:node . /app
# The database lives in a volume mounted here (/srv/serendip/data on the host).
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3140
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/api/v1/health || exit 1

CMD ["node", "server.js"]
