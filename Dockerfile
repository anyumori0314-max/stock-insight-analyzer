# syntax=docker/dockerfile:1
#
# Single PUBLIC image (Phase 21): ONE container serves the React SPA AND the
# Express `/api`. Run it with:
#
#   docker run --rm -p 3000:3000 -e STOCK_DATA_MODE=mock stock-insight-analyzer
#
# Multi-stage:
#   1. frontend — build the Vite SPA to frontend/dist.
#   2. build    — compile the TypeScript backend to dist/ (with dev deps).
#   3. deps     — install ONLY production backend deps (no tsx/vitest/typescript).
#   4. runtime  — slim, NON-ROOT image with dist/ + prod node_modules + the SPA.
#
# The backend serves frontend/dist (copied to /app/public) and falls back to
# index.html for non-/api routes; `/api/*` keeps the JSON contract. The SPA calls
# the API at the SAME origin (relative `/api`), so no build-time API URL is needed.
#
# Runtime needs Node >= 22.5 for the built-in node:sqlite (historical/hybrid modes
# + data CLIs). Persistent state (SQLite DB, disk cache, backups) lives under the
# /data VOLUME so it survives container restarts.

# ---- 1. frontend build ----------------------------------------------------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. backend build -----------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---- 3. production dependencies -------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ---- 4. runtime -----------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    STOCK_STATIC_DIR=/app/public \
    STOCK_DB_PATH=/data/history.sqlite \
    STOCK_CACHE_DIR=/data/stock-reports \
    STOCK_BACKUP_DIR=/data/backups
WORKDIR /app

# Compiled backend + production deps + the built SPA (no source, no dev deps).
COPY --from=deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist ./public
COPY backend/package.json ./package.json

# Persistent, writable data dir owned by the unprivileged built-in `node` user.
# /app (incl. ./public) stays owned by root and is only READ at runtime.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# Liveness probe hits the in-process /api/health endpoint (no external calls).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
