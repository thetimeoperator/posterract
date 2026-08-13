# Posterract VPS stack

This is one Docker Compose project modeled on Postiz's production topology:

- Posterract web, API, and Temporal orchestrator
- Product PostgreSQL 17
- Redis 7.2
- Elasticsearch 7.17.27
- Temporal 1.28.1 with a separate PostgreSQL 16 persistence store
- Temporal UI on the VPS Tailscale address only
- Direct multipart Cloudflare R2 upload endpoints

Only the Caddy gateway is bound to host loopback:

```text
127.0.0.1:3000 -> gateway -> web/api
```

Temporal UI binds only to the configured Tailscale IP. PostgreSQL, Redis,
Elasticsearch, Temporal, the API, and the worker have no public host ports.

## Bootstrap

From the repository root:

```bash
cp apps/web/.env.local /srv/posterract/frontend.env
deploy/posterract/scripts/bootstrap-env.sh /srv/posterract
docker compose --env-file /srv/posterract/.env \
  -f deploy/posterract/compose.yaml up -d --build
```

The `migrations` service applies the versioned Posterract SQL migrations and
the Better Auth PostgreSQL schema before the API or worker starts. PostgreSQL
is the application source of truth when `VITE_API_URL=/api`; leave this value
empty for a temporary Convex-backed staging build.

R2 variables are intentionally empty on first bootstrap. Fill them in
`/srv/posterract/.env` before enabling multipart uploads:

```text
R2_ACCOUNT_ID=
R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
R2_REGION=auto
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=posterract
```

Completed uploads use stable object keys:

```text
uploads/{workspaceId}/{mediaId}/source.{extension}
```

An upload that is completed but never attached to a post is automatically
deleted after 24 hours. Attached, scheduled, and publishing media must have
`purge_after` cleared by the post-attachment transaction. Cloudflare's
seven-day incomplete-multipart lifecycle rule remains a separate safety net
for abandoned multipart fragments.

## Convex cutover rehearsal

Do not import directly into the production database first. Export Convex,
rehearse against an isolated PostgreSQL database, and reconcile every count:

```bash
pnpm --filter @posterract/api convex:import ./snapshot.zip --dry-run

DATABASE_URL="postgresql://..." \
BETTER_AUTH_SECRET="..." \
pnpm --filter @posterract/api db:migrate:all

DATABASE_URL="postgresql://..." \
TOKEN_ENCRYPTION_KEY="..." \
MIGRATION_CONFIRM=postgres-cutover \
pnpm --filter @posterract/api convex:import ./snapshot.zip --apply

DATABASE_URL="postgresql://..." \
pnpm --filter @posterract/api convex:reconcile ./snapshot.zip
```

The importer deliberately invalidates every old session, keeps Better Auth
credential password hashes, encrypts social tokens with AES-256-GCM, and fails
instead of silently skipping Convex Storage artifacts. The current production
snapshot has no artifacts because the test videos were removed. Keep Convex
read-only as the rollback source until the VPS has passed acceptance tests.

## Agent keys

Agent API keys are hashed in PostgreSQL and use least-privilege scopes. Create
one inside the API container; the plaintext is printed once:

```bash
docker compose --env-file /srv/posterract/.env \
  -f deploy/posterract/compose.yaml exec api \
  node apps/api/scripts/create-api-key.mjs pahlevansina@gmail.com "Creator agent"
```

The complete posting handoff is in `docs/agent-api.md`.

## Health

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
docker compose --env-file /srv/posterract/.env \
  -f deploy/posterract/compose.yaml ps
```

`/health/ready` reports R2 separately because R2 is an external service, not a
container dependency.
