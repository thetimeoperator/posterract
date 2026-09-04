FROM node:24-bookworm-slim AS workspace

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/web/package.json apps/web/package.json
COPY apps/editor-sandbox/package.json apps/editor-sandbox/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/orchestrator/package.json apps/orchestrator/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/contract/package.json packages/contract/package.json
COPY packages/hyperkit/package.json packages/hyperkit/package.json
COPY packages/posterract-cli/package.json packages/posterract-cli/package.json
COPY packages/posterract-composition/package.json packages/posterract-composition/package.json
COPY packages/posterract-koota-solid/package.json packages/posterract-koota-solid/package.json
COPY packages/posterract-video-assets/package.json packages/posterract-video-assets/package.json
COPY packages/posterract-video-encoder/package.json packages/posterract-video-encoder/package.json
COPY packages/posterract-video-reconciler/package.json packages/posterract-video-reconciler/package.json
COPY packages/posterract-video-runtime/package.json packages/posterract-video-runtime/package.json
COPY packages/video-compiler/package.json packages/video-compiler/package.json

RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json tsconfig.base.json
COPY posterract-icon-1024.png posterract-icon-1024.png

FROM workspace AS web-build

ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
ARG VITE_API_URL
ARG VITE_SITE_URL
ARG VITE_DESKTOP_MAC_DOWNLOAD_URL
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SITE_URL=$VITE_SITE_URL
ENV VITE_DESKTOP_MAC_DOWNLOAD_URL=$VITE_DESKTOP_MAC_DOWNLOAD_URL

# The canvas is desktop-only: a project is TSX on the user's disk and the agent
# bridge is a local process, so the web build ships the scheduler and the download
# screen. Desktop bundles its own copy of the editor under renderer/editor-sandbox,
# so building it here only put a second, unreachable editor on the public origin.
RUN pnpm --filter @posterract/composition build \
    && pnpm --filter @posterract/web build

FROM nginx:1.29-alpine AS web-runtime
COPY deploy/posterract/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

FROM workspace AS backend-runtime

ENV NODE_ENV=production
COPY deploy/posterract/postgres/init ./deploy/posterract/postgres/init
EXPOSE 3001 3002

FROM backend-runtime AS orchestrator-runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
