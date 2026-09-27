# AI FOR SAVAGES Hub — the membership service.
#
# Self-contained: apps/hub depends only on published npm packages, so this does
# not need the pnpm workspace. Keep it that way — the Hub is the one thing that
# must keep answering when the rest of the stack is being rebuilt.

FROM node:22-alpine

WORKDIR /app

# Install first, with only the manifest copied, so a source edit does not
# re-resolve the dependency tree.
COPY apps/hub/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY apps/hub/src ./src
COPY apps/hub/scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3003

# tsx is a runtime dependency: the sources are .js but are loaded through it so
# the container runs the same loader the tests do.
CMD ["node", "--import", "tsx", "src/server.js"]
