# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm --prefix backend ci && npm --prefix frontend ci
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
RUN npm --prefix backend run build \
    && npm --prefix frontend run build \
    && npm --prefix backend prune --omit=dev

# Ubuntu supplies MySQL Server (not MariaDB). Only the Node binary is needed at runtime.
FROM ubuntu:24.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
       mysql-server ca-certificates libstdc++6 libatomic1 tini \
    && rm -rf /var/lib/apt/lists/* /var/lib/mysql/* \
    && groupadd --gid 10001 afterlife \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin afterlife \
    && mkdir -p /var/lib/after-life /run/mysqld \
    && chown afterlife:afterlife /var/lib/after-life \
    && chown mysql:mysql /run/mysqld
COPY --from=build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY docker/*.mjs /opt/after-life/
COPY .env.example /app/.env.example
RUN ln -s /etc/after-life/.env /app/.env \
    && mkdir -p /app/backend/.codex \
    && ln -s /var/lib/after-life/resources /app/backend/.codex/resources
ENV NODE_ENV=production
EXPOSE 3000
VOLUME ["/var/lib/mysql", "/var/lib/after-life", "/etc/after-life"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD ["node", "/opt/after-life/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/after-life/entrypoint.mjs"]
