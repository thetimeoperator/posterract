FROM node:24-bookworm-slim AS workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/hyperkit/package.json packages/hyperkit/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages

FROM workspace AS web-build

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_API_URL
ARG VITE_SITE_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SITE_URL=$VITE_SITE_URL

RUN pnpm --filter @posterract/web build

FROM nginx:1.29-alpine AS web-runtime
COPY deploy/posterract/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

FROM workspace AS backend-runtime

ENV NODE_ENV=production
COPY deploy/posterract/postgres/init ./deploy/posterract/postgres/init
EXPOSE 3001 3002
