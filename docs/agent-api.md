# Posterract Agent API

This is the handoff contract for an agent posting to the Posterract workspace
owned by `pahlevansina@gmail.com`.

## Credentials

The agent receives two environment variables. Never paste the key into a prompt,
commit it, or put it in a URL.

```bash
export POSTERRACT_API_URL="https://posterract-api.makeaiugcvids.com/api"
export POSTERRACT_API_KEY="pr_live_..."
```

The production key is created only after the PostgreSQL import succeeds:

```bash
docker compose --env-file /srv/posterract/.env \
  -f deploy/posterract/compose.yaml exec -T api \
  node apps/api/scripts/create-api-key.mjs \
  pahlevansina@gmail.com "Sina posting agent"
```

Posterract stores only the SHA-256 hash. The plaintext key is printed once.
The default key can read connected accounts and analytics, upload video, create
and read posts, cancel posts, and retry failed platform projections. It cannot
connect or disconnect social accounts.

The agent hostname routes directly through Cloudflare Tunnel to the VPS, so
agent traffic does not traverse the Vercel frontend proxy. The website itself
continues to use its same-origin `/api` route for browser cookies.

## Fastest posting interface

An agent with a local video can use the checked-in client:

```bash
pnpm --filter @posterract/api agent:post -- \
  ./video.mp4 \
  instagram,tiktok,youtube,threads,facebook \
  "The shared caption" \
  now \
  "Internal title"
```

The fifth argument may be an ISO-8601 time instead of `now`, for example
`2026-08-14T17:30:00Z`. The command uploads directly to private R2 in 16 MiB
parts, completes the upload, schedules the post, and prints the post and
projection IDs.

## HTTP contract

Every request uses:

```http
Authorization: Bearer pr_live_...
```

Every create, cancel, duplicate, or retry request also uses a stable unique
header. Repeating the same request with the same value safely replays the first
response. Do not reuse it for different data.

```http
Idempotency-Key: 9e54cfa3-447e-4d9e-a1db-7443cebbef93
```

### Connected accounts

```bash
curl -fsS "$POSTERRACT_API_URL/v1/accounts" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY"
```

Only choose accounts whose status is `connected`. The current code publishes
through Instagram, TikTok, YouTube, Threads, and Facebook Pages. X is represented
in the API but remains blocked until Posterract has official X API credentials
and a connector.

### Upload

1. `POST /v1/uploads/multipart` with `fileName`, `contentType`, and `sizeBytes`.
2. For each 5 MiB-or-larger part, call
   `POST /v1/uploads/multipart/{uploadId}/parts/{partNumber}`.
3. `PUT` that part directly to the returned signed R2 URL and retain its `ETag`.
4. `POST /v1/uploads/multipart/{uploadId}/complete` with the ordered
   `{PartNumber, ETag}` list.
5. Use the returned `mediaId` as `artifactId` when creating a post.

Use `DELETE /v1/uploads/multipart/{uploadId}` to abort an unfinished upload.
The bundled `agent:post` command implements the complete protocol.

### Create or schedule a post

```bash
curl -fsS "$POSTERRACT_API_URL/v1/posts" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  --data '{
    "artifactId": "POSTGRES_MEDIA_UUID",
    "title": "Internal title",
    "caption": "Shared caption",
    "hashtags": ["posterract"],
    "platforms": ["instagram", "tiktok", "youtube"],
    "perPlatform": {
      "youtube": {
        "caption": "YouTube description",
        "options": {
          "title": "YouTube title",
          "privacyStatus": "private",
          "madeForKids": false,
          "containsSyntheticMedia": false,
          "notifySubscribers": false
        }
      }
    },
    "scheduledFor": "now"
  }'
```

The response is `202 Accepted` and contains the transmission ID plus one
projection ID per platform. Scheduling is durable in Temporal; an agent does
not have to remain running.

### Read status

```bash
curl -fsS "$POSTERRACT_API_URL/v1/posts/TRANSMISSION_UUID" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY"

curl -fsS "$POSTERRACT_API_URL/v1/posts/TRANSMISSION_UUID/events" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY"

curl -fsS "$POSTERRACT_API_URL/v1/posts?limit=25&status=scheduled" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY"
```

The terminal master states are `live`, `partial`, `failed`, or `canceled`.
Inspect each projection because one platform may succeed while another fails.

### Cancel, duplicate, or retry

```bash
curl -fsS -X POST "$POSTERRACT_API_URL/v1/posts/TRANSMISSION_UUID/cancel" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"

curl -fsS -X POST "$POSTERRACT_API_URL/v1/posts/TRANSMISSION_UUID/duplicate" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"

curl -fsS -X POST "$POSTERRACT_API_URL/v1/projections/PROJECTION_UUID/retry" \
  -H "Authorization: Bearer $POSTERRACT_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

A duplicate is scheduled one hour from creation. A projection may be retried
only from `failed`, `blocked`, or `needs_reauth`.

## Safety rules for agents

- Check `/v1/accounts` before posting and never claim a disconnected platform
  succeeded.
- Reuse an idempotency key only when retrying the exact same HTTP operation.
- Poll status; a `202` means accepted, not published.
- Do not retry validation or authorization errors blindly.
- Never log signed R2 URLs, API keys, OAuth tokens, or raw provider responses.
- Do not request OAuth account-write scope for a posting agent.
