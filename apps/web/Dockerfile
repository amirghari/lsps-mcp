# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────────
# Production image for @lsps/web
#
# Vite builds a static SPA bundle (apps/web/dist). We ship it via a tiny
# nginx image that:
#   - serves /assets/* with strong caching
#   - falls back to /index.html for client-side routes (SPA)
#   - listens on $PORT (most PaaSes inject this)
# ──────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=10.14.0

# ─── base / deps / build ─────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/types/package.json ./packages/types/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@lsps/web..." --filter "@lsps/types..."

FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY packages/types ./packages/types
COPY apps/web ./apps/web
RUN pnpm --filter @lsps/web run build

# ─── runtime ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache gettext
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV PORT=8080
EXPOSE 8080
# envsubst replaces ${PORT} in the template at container startup so the same
# image works on platforms that inject PORT (Pxxl/Render/Fly/Cloud Run).
CMD ["/bin/sh", "-c", "envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
