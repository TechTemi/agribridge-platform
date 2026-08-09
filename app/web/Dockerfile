# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the AgriBridge web tier.
#
# The build stage carries Node and the whole npm tree; the runtime stage carries
# nginx plus a directory of static files. That is where the size reduction comes
# from - show `docker images` before and after during the recording.
#
# Pin both bases by digest before the final build. A tag is mutable.

# ---------------------------------------------------------------- build ------
FROM node:20.18-alpine3.20 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY index.html vite.config.js ./
COPY src ./src

ARG GIT_SHA=unknown
ARG APP_VERSION=0.0.0
ENV VITE_GIT_SHA=${GIT_SHA} VITE_APP_VERSION=${APP_VERSION}

RUN npm run build

# -------------------------------------------------------------- runtime ------
FROM nginx:1.27-alpine-slim AS runtime

ARG GIT_SHA=unknown
ARG APP_VERSION=0.0.0
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="agribridge-web" \
      org.opencontainers.image.description="AgriBridge marketplace web app" \
      org.opencontainers.image.source="https://github.com/OWNER/agribridge-platform" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="MIT"

# No package installation at all. The entrypoint substitutes the API upstream with
# sed, which busybox already provides - so the ~50 MB gettext package that would
# otherwise be pulled in just for envsubst is not needed. alpine-slim rather than
# alpine for the same reason: this image serves static files and proxies one path,
# and needs none of the extra modules.
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY docker-entrypoint.sh /docker-entrypoint-agribridge.sh
COPY --from=build /app/dist /usr/share/nginx/html

# The stock nginx image already ships an `nginx` user (uid 101). Give it
# ownership of what it must read, and nothing else.
RUN chmod +x /docker-entrypoint-agribridge.sh \
    && chown -R 101:101 /usr/share/nginx/html \
    && mkdir -p /tmp \
    && chmod 1777 /tmp

# Unprivileged. Combined with listen 8080 in the config, this container needs
# no capabilities at all - the chart drops ALL.
USER 101:101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/docker-entrypoint-agribridge.sh"]
