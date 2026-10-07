# Meta Muse connector

Posterract as a connector for Meta Muse (and any other MCP client): Muse can post
and schedule videos on Instagram, TikTok, Facebook and Threads, run the calendar,
use the video library, read analytics, and play the points game.

TikTok joined on September 30, 2026, when its Content Posting API Direct Post audit
was approved. YouTube is not offered until its quota extension is approved.

## Where it lives

| Piece | Where |
|---|---|
| Endpoint | `POST /v1/mcp` on the API service. Public at `https://api.posterract.app/v1/mcp`, and at `https://www.posterract.app/api/v1/mcp` through the same gateway. |
| Code | `apps/api/src/mcp/` |
| Approval page | `/connect` on the website (`apps/web/src/routes/connect.tsx`); connected apps are listed in Settings (`apps/web/src/components/ConnectedApps.tsx`) |
| Database | `deploy/posterract/postgres/init/023-connector-sign-in.sql` (registered apps, sign-in requests, connections, codes, tokens) |
| Tests | `apps/api/test/mcp.test.js`, `apps/api/test/mcp-auth.test.js` |
| Server | The existing `api` container on the VPS. There's no new service; the gateway already routes `/v1/*` to the API, and the web container passes the `/.well-known/oauth-*` sign-in discovery addresses to it (`deploy/posterract/nginx.conf`). |

Muse runs in Meta's cloud and reaches the endpoint over the internet. Posterract
Desktop and the video editor play no part in it.

```
apps/api/src/mcp/
  index.js          the endpoint and the MCP methods (initialize, tools/list, tools/call, ping)
  auth.js           the sign-in link: OAuth 2.1 + PKCE with dynamic client registration
  context.js        what every tool gets: in-process REST calls as the caller, errors, checks
  instructions.js   what the agent is told about Posterract when it connects
  safe-download.js  public-link downloads for import_video_from_url (blocks private addresses)
  tools/
    posting.js      create_post, get_post
    accounts.js     list_accounts
    calendar.js     list_schedule, reschedule_post, cancel_post, duplicate_post, retry_post
    library.js      list_videos, start_video_upload, finish_video_upload, import_video_from_url
    analytics.js    get_analytics
    game.js         get_my_rank, get_leaderboard, get_post_points
```

**Design rule: tools are a thin layer over the public REST API.** Each tool calls
the same `/v1/...` routes the app uses, in-process and with the caller's own key.
So permissions, the paid-plan check, rate limits (120 requests a minute per key),
validation and duplicate-post protection are exactly the REST API's. The game
tools read the points module (`apps/api/src/points.js`) directly.

## What it can do

| # | Capability | Tools | Key scope needed |
|---|---|---|---|
| 1 | Post and schedule | `create_post`, `get_post` | `posts:write` / `posts:read` |
| 2 | Many accounts at once | `list_accounts` (accounts and businesses); `create_post` with a `business_id` posts to every account in it, even two on one platform | `accounts:read` |
| 3 | The calendar | `list_schedule`, `reschedule_post`, `cancel_post`, `duplicate_post`, `retry_post` | `posts:read` / `posts:write` |
| 4 | The video library | `list_videos`, `start_video_upload` + `finish_video_upload`, `import_video_from_url` | `posts:read` or `media:write` |
| 5 | Analytics | `get_analytics` | `analytics:read` |
| 6 | The game | `get_my_rank`, `get_leaderboard`, `get_post_points` | `points:read` or `posts:read` |

`tools/list` only shows the tools the caller's key can use.

## Safety

- **Publishing needs a yes.** `create_post` returns a preview unless called with
  `confirm: true`. The agent is told to show the preview and wait for the user.
  `cancel_post` and `duplicate_post` work the same way.
- **Retries don't double-post.** A write tool called again with the same arguments
  within ten minutes reuses its idempotency key and replays the first result.
- **Accounts:** only Instagram, TikTok, Facebook and Threads accounts can be
  targeted; anything else is refused.
- **TikTok posts go to everyone by default.** `create_post` takes an optional
  `tiktok` object: who can watch (`everyone` by default; `friends`, `followers`,
  `only_me`), comments, Duet and Stitch, `your_brand` / `branded_content`
  disclosure, `ai_generated`, or `send_to_inbox`. The preview fetches each TikTok
  account's current settings and shows its name, the audience, disabled
  interactions, the longest video, the label TikTok will add and TikTok's
  declaration. The API checks the settings against the live account before
  accepting the post. A TikTok post can't be copied with `duplicate_post`: the
  agent is told to create it again.
- **Link imports** accept public `https` links only (port 443, no credentials).
  Every address is checked when the connection is made, including after
  redirects, so private, loopback, link-local and carrier-NAT addresses (such
  as the VPS's own Tailscale network) can't be reached. Imports are capped at
  1 GB and 4 minutes.
- **Access:** requires a sign-in token or an API key on a workspace with an
  active plan. Otherwise the endpoint answers 401 with a `Bearer` challenge
  that points to the sign-in details, which is how Muse knows to send the
  sign-in link.
- **Sign-in tokens** last an hour; refresh tokens rotate and last 60 days. A
  spent code used again, or a spent refresh token used again more than a
  minute later, ends the whole connection. Within that minute a repeat refresh
  just gets fresh tokens, so an app refreshing twice at once stays connected.
  The user can disconnect any app in Settings → Connected apps.

## Connecting Muse

The same flow as Postiz: one link, then a sign-in link. No key to copy.

1. The user connects Instagram, TikTok, Facebook or Threads in Posterract first.
2. In Muse, they send:

   > Connect to Posterract. Its MCP server URL is
   > https://api.posterract.app/v1/mcp. I want you to post and schedule my videos on
   > Instagram, TikTok, Facebook and Threads, check my analytics, and tell me my
   > Posterract rank and points.

3. Muse registers itself, then sends a sign-in link. The link opens
   Posterract's `/connect` page, which shows what Muse is asking to do.
4. The user clicks **Allow** and is sent back to Muse, which is now connected.

For tools that can't sign in, an API key from Posterract → API Keys still works
as the bearer token.

How it works underneath (`auth.js`):

| Step | Address |
|---|---|
| Muse finds the sign-in details | `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` |
| Muse registers itself | `POST /v1/oauth/register` |
| The sign-in link | `GET /v1/oauth/authorize`, which sends the browser to `/connect` |
| The user allows or denies | `/connect`, which calls `POST /v1/oauth/requests/:id/decision` |
| Muse gets its tokens | `POST /v1/oauth/token` |
| Disconnecting | Settings, or `POST /v1/oauth/revoke` from the app |

## Next

1. **Directory submission** at [muse.ai/platform](https://muse.ai/platform).
   Needs a reviewer test workspace, an icon, example prompts, and a company
   email.
2. **Recipes:** the Posterract skill and templates, so Muse can build videos
   in its own cloud and edit them by chat.
