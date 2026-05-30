# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────────
# Production image for @lsps/api
#
# Multi-stage:
#   1. base       — node + pnpm
#   2. deps       — install all workspace deps (with cache mount for speed)
#   3. build      — compile TypeScript, generate Prisma client
#   4. runtime    — minimal image with compiled JS + node_modules + Prisma engine
#
# The Prisma client must be regenerated AFTER `pnpm install` and BEFORE the
# code is compiled; the generated client lives under node_modules/.pnpm/...
# and is part of the runtime artifact.
# ──────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=10.14.0

# ─── base ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS base
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ─── deps ────────────────────────────────────────────────────────────────
FROM base AS deps
# Copy only files needed to resolve the workspace graph; this maximises
# the Docker layer cache hit rate on subsequent code-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
# apps/web is intentionally not copied here — it's not needed to build/run the API.

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@lsps/api..." --filter "@lsps/types..."

# ─── build ───────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/types ./packages/types
COPY apps/api ./apps/api
# Generate the Prisma client + compile TS to ./apps/api/dist
RUN pnpm --filter @lsps/api exec prisma generate
RUN pnpm --filter @lsps/api run build

# ─── runtime ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
RUN apk add --no-cache libc6-compat openssl tini
WORKDIR /app
ENV NODE_ENV=production

# Copy the assembled monorepo so workspace symlinks resolve at runtime.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/packages/types ./packages/types

# tini reaps zombies and forwards SIGTERM cleanly so graceful shutdown works.
ENTRYPOINT ["/sbin/tini", "--"]

# Run migrations (idempotent) then start the server.
# `prisma migrate deploy` only applies pending migrations — it never alters
# the schema interactively, safe to run on every boot.
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "node ../../node_modules/.pnpm/prisma@*/node_modules/prisma/build/index.js migrate deploy && node dist/server.js"]
