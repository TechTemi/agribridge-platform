# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the AgriBridge API.
#
# Retires findings F-03 (no immutable artefact), F-04 (non-deterministic
# builds) and SEC-2 (a 1.4 GB image running as root with 19 critical CVEs).
#
# Pin the digests below to the ones you actually used, with:
#   docker pull node:20.18-alpine3.20 && docker inspect --format='{{index .RepoDigests 0}}' node:20.18-alpine3.20
# A tag is mutable; a digest is not, and reproducibility is the whole point.

# ---------------------------------------------------------------- build ------
FROM node:20.18-alpine3.20 AS build

WORKDIR /app

# Manifests first, source second. This ordering means a source-only change
# reuses the cached dependency layer, which is most of the pipeline budget.
COPY package.json package-lock.json ./

# `npm ci` installs exactly the lockfile - the direct fix for F-04, where an
# ungitignored lockfile let `npm install` silently upgrade a database driver.
# --ignore-scripts blocks arbitrary code execution from transitive packages.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY src ./src

# Prune dev dependencies so the runtime stage never sees vitest or eslint.
RUN npm prune --omit=dev --ignore-scripts

# -------------------------------------------------------------- runtime ------
FROM node:20.18-alpine3.20 AS runtime

# Injected by the pipeline from the git context. These become /version output
# and the agribridge_build_info metric - the last links in the traceability
# chain a reviewer will ask you to walk.
ARG GIT_SHA=unknown
ARG APP_VERSION=0.0.0
ARG BUILD_DATE=unknown
ARG IMAGE_TAG=local

LABEL org.opencontainers.image.title="agribridge-api" \
      org.opencontainers.image.description="AgriBridge marketplace API" \
      org.opencontainers.image.source="https://github.com/OWNER/agribridge-platform" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=3000 \
    GIT_SHA=${GIT_SHA} \
    APP_VERSION=${APP_VERSION} \
    BUILD_DATE=${BUILD_DATE} \
    IMAGE_TAG=${IMAGE_TAG} \
    NODE_OPTIONS=--max-old-space-size=384

# dumb-init reaps zombies and, more importantly, forwards SIGTERM to node so
# graceful shutdown actually runs. Without a real init, node is PID 1 and
# signal handling is subtly wrong - which is how rolling updates drop requests.
RUN apk add --no-cache dumb-init=1.2.5-r3 \
    && addgroup -g 10001 -S app \
    && adduser -u 10001 -S app -G app

WORKDIR /app

COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/src ./src
COPY --from=build --chown=10001:10001 /app/package.json ./package.json

# Never root. The chart additionally enforces runAsNonRoot, so a future change
# that drops this line fails admission rather than shipping quietly.
USER 10001:10001

EXPOSE 3000

# Kubernetes probes supersede this at runtime, but it keeps `docker compose ps`
# and any plain-Docker demo honest.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
