# Posterract VPS Migration Master Plan

Last updated: August 19, 2026

## August 19 deployment clarification

Posterract production is served entirely by the Docker Compose stack in
`/srv/posterract/source` on the VPS. Caddy routes the web application and API;
Cloudflare Tunnel carries public traffic to that gateway. Vercel is retired and
must not be used for Posterract deployments.

## August 13 production cutover update

The PostgreSQL replacement is live. The production frontend uses
`VITE_API_URL=/api`, and Caddy proxies that same-origin API path inside the VPS
stack. Better Auth, product data, encrypted social
tokens, authenticated OAuth/account management, direct R2 uploads, the
scoped/idempotent agent API, the transactional outbox, Temporal publishing, and
analytics ingestion now use the VPS stack. Convex is retained only as a
temporary rollback source; it is no longer the production application backend.

The final production Convex snapshot was imported into PostgreSQL 17 and
reconciled exactly: 16 users, 15 workspaces, 90 social-account slots, 5 social
tokens, 7 transmissions, 9 projections, and all related history and analytics.
All 24 Convex sessions were deliberately invalidated. A least-privilege agent
key was issued for `pahlevansina@gmail.com`; the plaintext is stored only in the
VPS credential file and the owner's local mode-600 credential file. Instagram,
TikTok, YouTube, Threads, and Facebook are connected. X remains blocked because
there is no connected X account or official X connector.

## Objective

Move Posterract from its current Vercel and Convex architecture to a
self-hosted, Postiz-inspired architecture on the Posterract VPS without
interrupting existing testers.

The target architecture uses:

- One Docker Compose project
- Caddy as the private application gateway
- PostgreSQL 17 as the Posterract source of truth
- Redis 7.2 for temporary state, caching, locks, rate limits, and upload sessions
- Elasticsearch 7.17 for Temporal visibility and fast analytics exploration
- Temporal 1.28 with a separate PostgreSQL 16 persistence database
- Cloudflare R2 for temporary scheduled-video storage
- Uppy for direct browser-to-R2 multipart uploads
- Cloudflare Tunnel for public traffic
- Tailscale for private administration

## Current State

### Completed

- Cleared approximately 52 GB of Docker build cache from the VPS.
- Retired the previous MakeAI services recoverably.
- Created a single Posterract Docker Compose stack.
- Installed and started:
  - Posterract web
  - Caddy gateway
  - Posterract API foundation
  - Posterract Temporal worker
  - PostgreSQL 17
  - Redis 7.2
  - Elasticsearch 7.17
  - Temporal 1.28
  - Temporal PostgreSQL 16
  - Temporal UI
- Configured persistent Docker volumes.
- Kept PostgreSQL, Redis, Elasticsearch, Temporal, the API, and the worker off
  public host ports.
- Bound the application gateway to `127.0.0.1:3000`.
- Bound Temporal UI to the VPS Tailscale IP only.
- Installed the Posterract PostgreSQL foundation schema.
- Installed the Elasticsearch index template.
- Registered the `posterract` Temporal namespace and custom search attributes.
- Executed a successful end-to-end Temporal smoke workflow.
- Confirmed the API can reach PostgreSQL, Redis, Elasticsearch, and Temporal.
- Configured bounded Docker log rotation.
- Prepared direct Cloudflare R2 multipart-upload API endpoints.
- Configured the private `posterract` R2 bucket and authenticated S3 endpoint.
- Configured and verified R2 CORS for production and local origins.
- Added Uppy 5 multipart support for direct browser-to-R2 transfers.
- Added stable media keys:
  `uploads/{workspaceId}/{mediaId}/source.{extension}`.
- Added scoped, hashed `media:write` agent API keys.
- Added upload-size verification after multipart completion.
- Added 24-hour cleanup scheduling for completed but unattached media.
- Completed a real two-part API-key-authorized upload through the VPS API to R2,
  verified PostgreSQL and R2 state, and removed the test data.
- Pointed the VPS Cloudflare Tunnel configuration at:
  - `posterract.app`
  - `www.posterract.app`
  - `api.posterract.app`
- Deployed the complete PostgreSQL API and Temporal publishing worker.
- Migrated and reconciled the final production Convex snapshot.
- Switched the production frontend, authentication, analytics, scheduling, and
  uploads to the PostgreSQL API.
- Added the public same-origin `/api` proxy through Vercel and Cloudflare
  Tunnel.
- Issued and smoke-tested the scoped API key for
  `pahlevansina@gmail.com`.

### Not Complete

- The private staging hostname still needs its DNS record changed from the
  obsolete Vercel target to the Cloudflare Tunnel target in the
  `posterract.app` zone.
- The staging origin still needs to be added to R2 CORS from the Cloudflare
  dashboard. The deliberately object-only runtime credential cannot administer
  bucket settings.
- The Google Drive Watch Folder has not yet been built.
- Automated off-VPS backups, restore drills, monitoring, and alerts are not yet
  complete.
- X publishing remains unavailable until an official connector, credentials,
  and a connected X account exist.

## Phase 1: Configure Cloudflare R2

The private R2 bucket is named `posterract`.

### Tasks

- [x] Create bucket-scoped S3 credentials.
- [x] Add the R2 account ID, explicit endpoint, access-key ID, secret, and bucket name to the VPS
  deployment environment.
- [x] Configure CORS for production and local Posterract origins.
- [ ] Add `https://staging.posterract.app` to R2 CORS from the Cloudflare
  dashboard before testing browser uploads on staging.
- [x] Build the Uppy client for the multipart-upload API.
- [x] Test multipart creation, part signing, listing, completion, cancellation,
  and large uploads.
- [x] Verify that upload bytes go directly to R2 instead of through
  the VPS.
- [x] Give every video one stable object key:
  `uploads/{workspaceId}/{mediaId}/source.{extension}`.
- Keep media lifecycle status in PostgreSQL rather than moving objects between
  status-named R2 folders. Expected statuses include `uploading`, `ready`,
  `scheduled`, `publishing`, `failed`, `published`, and `deleted`.
- [x] Add automatic unattached-upload cleanup.
- [ ] Connect the Uppy client to the signed-in website after browser-session
  authentication moves from Convex to the VPS API.
- [ ] Test interrupted-upload resumption in the signed-in browser.
- Add publication-confirmation cleanup.
- Record every deletion in the Posterract audit log.

### Media Retention Rules

- Unattached uploads: delete after 24 hours.
- Cancelled uploads: delete immediately.
- Failed scheduled posts: retain for approximately seven days to allow retries.
- Successfully published media: delete 24–72 hours after the platform confirms
  publication.
- Never delete scheduled media until every required platform has either
  published successfully or reached an explicit terminal state.
- A failed publication remains under its original `uploads/` key until it is
  retried or expires. There is no separate `failed/` R2 folder.
- Retain platform post IDs, analytics, captions, metadata, and publishing
  history after the original video is deleted.
- Do not provide an unlimited permanent media library.

Redis tracks upload sessions, locks, progress, and rate limits. R2 carries the
video bytes. PostgreSQL stores durable metadata and state.

## Phase 2: Complete Cloudflare DNS and Tunnel Cutover

The VPS tunnel configuration is ready, but the `posterract.app` zone currently
uses Vercel nameservers.

### Tasks

- Add `posterract.app` as a Cloudflare DNS zone.
- Change the domain nameservers at the registrar from Vercel DNS to Cloudflare.
- Add the tunnel routes inside the correct Cloudflare zone.
- Route `posterract.app`, `www.posterract.app`, and `api.posterract.app` through
  the Posterract tunnel.
- Choose a canonical hostname and redirect the alternative hostname.
- Verify TLS, compression, static assets, SPA routing, API routing, OAuth
  callbacks, and multipart-upload requests.
- Remove the accidental nested Posterract records created under the
  `makeaiugcvids.com` DNS zone.
- Rename the tunnel from `makeaiugcvids` to `posterract` if desired. The name is
  cosmetic and does not change tunnel operation.
- Confirm the retired MakeAI hostnames return a deliberate retirement response
  or `404`.

Changing DNS should happen only after the VPS application and the existing
Convex-backed production flows have been tested through the tunnel.

## Phase 3: Harden the VPS

### Tasks

- Add 2–4 GB of swap. The VPS has 7.6 GB RAM and currently has no swap.
- Configure nightly encrypted backups of the product PostgreSQL database.
- Configure nightly encrypted backups of the Temporal PostgreSQL database.
- Back up deployment configuration and encrypted secrets separately.
- Define backup retention and off-VPS backup storage.
- Perform and document complete restore tests.
- Add uptime checks for the gateway and API.
- Add health alerts for PostgreSQL, Redis, Elasticsearch, Temporal, the worker,
  and R2.
- Add disk, RAM, container-restart, and certificate alerts.
- Add structured application logs and error tracking.
- Validate persistence by restarting PostgreSQL, Redis, Elasticsearch, and
  Temporal individually.
- Pin and periodically review all production image versions.
- Create a repeatable deployment and rollback command or CI/CD workflow.

## Phase 4: Build the PostgreSQL Application Backend

The relational application backend is deployed and is the production source of
truth. The checklist below is retained as the implementation record.

### Tasks

- Finalize the relational schema.
- Adopt a migration system and database access layer. Drizzle is the current
  recommended candidate.
- Implement users, workspaces, memberships, social accounts, media, posts,
  platform projections, schedules, publication attempts, analytics, API keys,
  usage, points, and audit events.
- Add foreign keys, uniqueness rules, constraints, and performance indexes.
- Encrypt social access tokens and refresh tokens.
- Add workspace-level authorization.
- Add request idempotency so agents cannot create duplicate posts.
- Implement a transactional outbox so committed database changes reliably start
  Temporal workflows.
- Add retention and deletion jobs.
- Add database integration tests.

## Phase 5: Migrate Authentication and Convex Data

### Tasks

- Inventory every current Convex table, query, mutation, action, and scheduled
  function.
- Map Convex documents to PostgreSQL tables.
- Decide whether Better Auth remains on Convex during a staged migration or
  moves immediately.
- Migrate users, workspaces, social connections, drafts, scheduled posts,
  publication history, points, API keys, and analytics.
- Securely migrate social credentials where possible.
- Require reauthorization when a provider token cannot be migrated safely.
- Create record-count, ownership, and status reconciliation checks.
- Rehearse the migration using a production export.
- Keep Convex available as a rollback path during cutover.
- Remove Convex only after the PostgreSQL application has demonstrated stable
  production operation.

## Phase 6: Complete the Posterract API

The current VPS API is the production replacement for the former Convex
application backend. The checklist below is retained as the API contract.

### Required API Areas

- Authentication and sessions
- Workspaces and membership
- Social accounts and OAuth
- Upload initialization and completion
- Drafts and scheduled posts
- Shared and platform-specific captions
- Platform-specific publishing settings
- Publication status, retry, cancellation, and rescheduling
- Analytics and metric history
- API-key creation, scoping, rotation, and revocation
- Agent operations
- Webhooks
- Usage and rate limits

### API Requirements

- Versioned `/v1` routes
- OpenAPI documentation
- Scoped API keys
- Idempotency keys
- Pagination
- Per-workspace authorization and quotas
- Signed outgoing webhooks
- Audit logs
- Consistent provider-error normalization

## Phase 7: Complete the Temporal Publishing Engine

Temporal is installed and has passed a real workflow test. The production
publication workflow still needs to be implemented.

### Tasks

- Create one durable workflow per publication.
- Sleep durably until the scheduled publication time.
- Implement platform-specific publishing activities.
- Add provider-specific retry and backoff policies.
- Distinguish permanent failures from retryable failures.
- Refresh OAuth credentials before publishing.
- Poll asynchronous video-processing jobs.
- Store platform post and video IDs.
- Confirm publication before marking a projection successful.
- Delete R2 media only after all necessary platform outcomes are known.
- Support cancellation and rescheduling.
- Make workflows and activities idempotent.
- Add dead-letter and manual-review handling.
- Surface workflow state and errors to the frontend.

## Phase 8: Move Social Connectors

TikTok and YouTube should be implemented first because Posterract has access to
those platforms.

### TikTok and YouTube

- OAuth connection and refresh-token handling
- Scope and permission validation
- Account or channel discovery
- Upload and publication
- Asynchronous processing-status polling
- Provider quota and rate-limit handling
- Platform-specific publishing options
- Error normalization
- Analytics synchronization
- Private or unlisted end-to-end publication tests

### Later Connectors

1. Meta when approved
2. LinkedIn
3. X for posting only
4. Pinterest
5. Additional platforms

## Phase 9: Replace Frontend Convex Dependencies

The VPS currently serves the Posterract frontend, but the frontend still talks
to Convex.

### Tasks

- Create the new authenticated API client.
- Migrate frontend queries and mutations feature by feature.
- Replace the existing upload mechanism with Uppy direct-to-R2 multipart
  uploads.
- Support visible upload progress and interrupted-upload resumption.
- Connect scheduling to Temporal-backed API endpoints.
- Migrate authentication.
- Migrate social-account management.
- Migrate the analytics UI.
- Add publication workflow status, errors, cancellation, and retry controls.
- Remove the Convex client only after full feature parity and migration.

## Phase 10: Build Knowledge-Graph-Ready Analytics

The analytics data model should preserve entities, relationships, time, source,
and provenance.

```text
Workspace
  -> Social Account
    -> Campaign
      -> Post
        -> Platform Projection
          -> Metric Snapshot
          -> Audience Segment
          -> Content Features
```

### Data to Store

- Immutable raw provider responses
- Normalized cross-platform metrics
- Time-series metric snapshots
- Per-video and per-account metrics
- Watch time, retention, completion rate, views, likes, comments, shares, saves,
  followers, reach, impressions, and traffic sources where available
- Derived metrics such as velocity, engagement rate, retention quality, and
  conversion
- Content features such as hook, topic, format, duration, CTA, sound, caption,
  and posting time
- Metric provenance, freshness, and provider errors

### Analytics Tasks

- Implement platform-specific analytics ingestion.
- Schedule incremental synchronization jobs.
- Support historical backfills.
- Normalize comparable metrics without erasing provider-specific details.
- Create per-post, per-account, per-campaign, and cross-platform views.
- Expose analytics entities and relationships through the API.
- Add data-freshness indicators.
- Use PostgreSQL as the source of truth.
- Use Elasticsearch for fast exploration and search where it creates measurable
  value.

This structure will allow a user-hosted knowledge-graph template to consume
Posterract analytics later without requiring Posterract to host the graph.

## Phase 11: Add Creator and Agent Ingestion

Posterract should accept creatives through three primary paths.

### Website Upload

- Use Uppy to upload directly to R2.
- Create a media record immediately.
- Require the upload to be attached to a draft or scheduled post.
- Expire abandoned uploads automatically.

### Posterract Watch Folder

- Let a user connect Google Drive.
- Let the user select a watched folder.
- Detect newly added files.
- Import each creative into a draft or scheduling inbox.
- Mark or move successfully imported files.
- Detect duplicates.
- Show import status and errors.

### Agent API

- Let an agent create an upload session.
- Let the agent upload directly to R2.
- Let the agent create the shared post and platform projections.
- Let the agent schedule or immediately publish.
- Let the agent poll status or receive a signed webhook.
- Scope every API key by workspace and capability.
- Add quotas, idempotency, audit events, and revocation.

## Phase 12: Production Rehearsal and Cutover

### Required Tests

- Large and interrupted uploads
- Multipart resume and cancellation
- Container restart and data persistence
- TikTok and YouTube end-to-end publication
- OAuth callback routing through Cloudflare
- Scheduling, cancellation, retry, and duplicate-request behavior
- R2 cleanup after confirmed publication
- Database backup restoration
- API, upload, and scheduled-publication load tests
- Convex-to-PostgreSQL migration dry run
- Frontend feature parity
- Analytics synchronization accuracy
- Rollback execution

### Cutover

- Take a final Convex backup/export.
- Temporarily stop conflicting writes if required.
- Execute the verified data migration.
- Run reconciliation checks.
- Switch the frontend to the PostgreSQL API.
- Monitor errors, latency, workflow failures, storage, and provider quotas.
- Keep the rollback path available until stability is proven.
- Decommission Convex only after the rollback window closes.

## Recommended Execution Order

1. Configure R2.
2. Complete the Cloudflare zone, DNS, and tunnel cutover.
3. Add swap, backups, monitoring, and persistence tests.
4. Finalize PostgreSQL schema, authentication, and the complete API.
5. Connect Uppy and enforce the media lifecycle.
6. Implement TikTok and YouTube publishing through Temporal.
7. Migrate the frontend away from Convex.
8. Build the analytics ingestion and normalization pipeline.
9. Add Google Drive Watch Folder and agent workflows.
10. Rehearse the migration and perform the production cutover.

## Definition of Done

The migration is complete when:

- Testers use the VPS-hosted Posterract application.
- Posterract application data lives in PostgreSQL.
- Authentication no longer depends on Convex.
- Browser and agent uploads go directly to R2.
- Scheduled publishing is durable in Temporal.
- TikTok and YouTube publication and analytics work end to end.
- Media is deleted according to the retention policy.
- Backups and restore tests pass.
- Monitoring and alerts are active.
- The frontend no longer depends on Convex.
- The analytics API is knowledge-graph-ready.
- The Convex and Vercel deployments can be retired safely.
