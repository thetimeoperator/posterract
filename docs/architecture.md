# Posterract architecture

What each part of the repo is, where it runs, and how they talk. (`vidtryx` is
only the old local folder name.)

## Where things run

| Part | Code | Runs on |
|---|---|---|
| Website and web app | `apps/web` (React, Vite) | VPS, `web` container (nginx) |
| API | `apps/api` (Fastify) | VPS, `api` container |
| Worker | `apps/orchestrator` (Temporal) | VPS, `orchestrator` container |
| Database and queues | PostgreSQL, Redis, Temporal, Elasticsearch | VPS, their own containers |
| Video storage | Cloudflare R2 | Cloudflare |
| Desktop app | `apps/desktop` (Electron) | The user's computer |
| Video editor | `apps/editor-sandbox` | Inside the desktop app |
| AI FOR SAVAGES hub | `apps/hub` | VPS, separate from Posterract |

The VPS stack is defined in `deploy/posterract/compose.yaml`. The Caddy gateway
(`deploy/posterract/Caddyfile`) sends `/v1/*`, `/api/v1/*`, `/api/auth/*` and
`/health/*` to the API, and everything else to the web container. Never Vercel.

## Shared packages

| Package | What it holds |
|---|---|
| `packages/contract` | Types and rules shared by web, API and worker: platforms, points rates, levels, ranks. |
| `packages/hyperkit` | The design system (tokens, components). |
| `packages/posterract-video-*`, `posterract-composition`, `video-compiler`, `posterract-cli`, `posterract-koota-solid` | The video engine the editor, desktop and CLI render with. |

## Inside the API (`apps/api/src`)

| Area | Files |
|---|---|
| Server, auth, posts, uploads, schedule | `server.js`, `domain.js`, `media.js` |
| Social accounts and OAuth | `oauth.js`, `meta.js`, `tiktok*.js` |
| Businesses (groups of accounts: posting to one, filtering analytics by one) | `businesses/`, `postTargets.js` |
| Analytics | `analytics.js` |
| Points, levels, leaderboard | `points.js` |
| Billing | `billing.js`, `billingPortal.js`, `credits.js` |
| Desktop sign-in | `desktopAuth.js` |
| API keys, agent runs, skills, cloud creative projects | `apiKeys.js`, `agents.js`, `skills.js`, `creative.js` |
| Email | `email.js` |
| AI | `ai/` |
| Meta Muse connector (MCP) | `mcp/`, see [muse-connector.md](muse-connector.md) |

Database schema is `deploy/posterract/postgres/init/NNN-*.sql`. Each file is
applied once, in order, by the `migrations` service, which checks checksums.

## How a post flows

1. A post is created from the web app, the desktop app, an API key, or Muse
   through `/v1/mcp`. All of these land on `POST /v1/posts`.
2. The worker publishes it on each platform at its time.
3. Twice a day the worker reads each account's stats.
4. Points are scored from those stats right after each read (`points.js`).
5. The Points tab, analytics and Muse's game tools all read the same numbers.

## Deploying

Web-only, API or worker changes: sync only the changed files to
`/srv/posterract/source`, then rebuild and restart just those services (see
`AGENTS.md`). Schema changes go in a new numbered migration, run by the
`migrations` service before the API restarts.
