# Platform Publishing APIs — Full Reference (researched July 2026)

How Posterract publishes/schedules organic content to each platform via API: which API to use, how to get access, exact scopes, endpoints, limits, token models, and gotchas. All claims verified against live official docs in July 2026 unless flagged as unverified. TikTok is already shipped and not covered here.

---

## Summary

| Platform | API | Access gate | Native scheduling | Daily publish limit | Token model |
|---|---|---|---|---|---|
| Instagram | Instagram API with Instagram Login | Meta App Review (~2–7 biz days/round) | No — server holds | 50–100/account (query at runtime) | 60d long-lived, refreshable |
| Facebook | Pages API | Same Meta App Review | **Yes** (`scheduled_publish_time`) | None documented | Page token, no expiry |
| Threads | Threads API (separate Meta app) | Own App Review | No — server holds | 250/account | 60d long-lived, refreshable |
| YouTube | Data API v3 `videos.insert` | OAuth verification **+** compliance audit (weeks–months) | **Yes** (`status.publishAt`) | ~100 uploads/day/project (default) | Indefinite refresh once in production |
| LinkedIn | Posts API `/rest/posts` | Member profiles: self-serve. Company pages: application | No — server holds | 150/day/member | 60d access; refresh tokens only for approved partners |
| Pinterest | API v5 `POST /v5/pins` | Trial (sandbox) → Standard upgrade (days) | No — server holds | None documented (100 creates/min) | 30d access + 60d rotating refresh, indefinite |
| Reddit | Data API `POST /api/submit` | Approval required; commercial = contract | No — server holds | Per-account throttles | 1h access + permanent rotating refresh |
| Snapchat | Public Profile API | **Allowlist-only via Snap BD contact** | No — server holds | Not published | 1h access + refresh tokens |

**Scheduling architecture:** only Facebook and YouTube accept a future publish time. Everywhere else the server holds the post and executes the publish call at time T — the existing TikTok pattern. Recommended: use server-side publishing uniformly (uniform edit/cancel UX), optionally leaning on YouTube `publishAt` since uploads are heavy.

**Approvals to kick off immediately (longest lead time first):**
1. YouTube API compliance audit + Google OAuth sensitive-scope verification (weeks–months; uploads are private-locked until audited)
2. LinkedIn Community Management API application (company pages; anecdotally months; **rejection is one-shot per app**)
3. Reddit access request, flagging commercial use (contract required for a paid product)
4. Meta App Review: IG+FB app, plus a separate Threads app review
5. Pinterest Trial → Standard upgrade
6. Snapchat: create Business Account + OAuth app, open BD conversation for allowlisting

---

## 1. Instagram

### API choice
Use the **Instagram API with Instagram Login** (host `graph.instagram.com`). The old Basic Display API was shut down Dec 4, 2024 — ignore tutorials referencing it.

| | Instagram Login (recommended) | Facebook Login for Business |
|---|---|---|
| Facebook Page required | **No** | Yes (IG must be linked to a FB Page — the #1 scheduler onboarding headache) |
| Content publishing | Yes (feed, Reels, Stories, carousels) | Yes |
| Hashtag search / product tagging | No | Yes |
| Host | `graph.instagram.com` | `graph.facebook.com` |

Both require the IG account to be **professional** (Business or Creator). Personal IG accounts cannot publish via API — users must convert in-app.

### Access
Meta App Review for Advanced Access on:
- `instagram_business_basic`
- `instagram_business_content_publish`

(Un-prefixed names `instagram_basic`/`instagram_content_publish` belong to the Facebook Login flavor; old IG-Login names were deprecated Jan 27, 2025.) Do not request comment/message scopes unless demoed. See [App Review checklist](#9-meta-app-review-checklist).

### OAuth (Instagram Login)
1. Authorize: `https://www.instagram.com/oauth/authorize` (`response_type=code`, comma-separated scopes)
2. Code → short-lived token (1h, single-use): `POST https://api.instagram.com/oauth/access_token`
3. Long-lived (60 days): `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...`
4. Refresh (~50-day cron; token must be ≥24h old and unexpired): `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`

### Publishing flow (container model)
1. Create container: `POST /{ig-user-id}/media`
2. Poll: `GET /{container-id}?fields=status_code` → `IN_PROGRESS` / `FINISHED` / `ERROR` / `EXPIRED` / `PUBLISHED` (poll ~1×/min, allow up to 5 min for video)
3. Publish: `POST /{ig-user-id}/media_publish?creation_id={container-id}`

Per content type:
- **Image:** `image_url` + `caption`, `alt_text` (≤1000 chars, added Mar 2025), `user_tags`, `location_id`. **JPEG only** (PNG rejected), ≤8 MB, aspect 4:5–1.91:1, width 320–1440px.
- **Video/Reels:** `media_type=REELS` + `video_url` (or resumable upload to `rupload.facebook.com/ig-api-upload/v25.0/{container-id}`). Optional `cover_url`, `thumb_offset`, `share_to_feed`, `collaborators` (≤3), `audio_name`, `is_paid_partnership`, `is_ai_generated`. All feed video is REELS now. Specs: MP4/MOV, H.264/HEVC, AAC ≤48kHz, 23–60fps, 9:16 recommended, ≤1920px wide, ≤25 Mbps, 3s–15min, ≤300 MB.
- **Carousel:** 2–10 child containers with `is_carousel_item=true` → parent `media_type=CAROUSEL` + `children=[ids]` → publish. Caption on parent only; Reels can't be carousel items.
- **Stories:** `media_type=STORIES` + `image_url` or `video_url`. No caption/stickers/links/polls via API. Story video 3–60s, ≤100 MB.

### Limits
- **Publish quota:** docs conflict (guide says 100 posts/24h, reference says 50). **Query at runtime:** `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config`. Carousel counts as 1.
- **Container creation:** 400 containers per rolling 24h per account. **Containers expire after 24h** — create at publish time, never at schedule time.
- API calls: BUC rate limiting (4800 × impressions per 24h); watch `X-Business-Use-Case-Usage` header. Throttle error codes: 4, 17, 32, 613, 80001–80014.

### Gotchas
- Media must be at a **publicly accessible URL** (Meta fetches it; ASCII-only URLs).
- Publishing an unfinished container errors — always poll first.
- 2FA / Page Publishing Authorization can block publishing.
- Caption ≤2200 chars, ≤30 hashtags, ≤20 @mentions.
- No native scheduling — server publishes at time T.

Docs: [Platform overview](https://developers.facebook.com/docs/instagram-platform), [Content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), [Media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media), [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [App Review](https://developers.facebook.com/docs/instagram-platform/app-review), [Publishing limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/)

---

## 2. Facebook

### API + hard constraint
**Pages API** via Facebook Login for Business. **Personal profiles/timelines are NOT supported** (`publish_actions` died 2018; Groups API removed Apr 2024). All publishing uses a **Page access token** from a user with the `CREATE_CONTENT` task on the Page.

### Access
Same Meta App Review (same app as Instagram). Advanced Access on:
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_posts`

Note: docs are inconsistent on `publish_video` (permissions reference scopes it to live video; one Pages API page mentions it for video posts). If FB video is core, request and demo it to be safe.

### OAuth / tokens
FB short-lived user token (~1–2h) → long-lived user token 60d (`grant_type=fb_exchange_token`) → Page tokens via `GET /me/accounts`. **Page tokens derived from a long-lived user token do not expire** (invalidated by password change/deauth). Store Page tokens.

### Publishing endpoints
- **Text/link:** `POST /{page-id}/feed` — `message`, `link`, `published`, `scheduled_publish_time`
- **Photo:** `POST /{page-id}/photos` — `url`, `caption`. JPEG/BMP/PNG/GIF/TIFF ≤10 MB (keep PNG ≤1 MB). Multi-photo: upload each with `published=false`, then `POST /{page-id}/feed` with `attached_media=[{"media_fbid":...}]`.
- **Video:** `POST /{page-id}/videos` (host `graph-video.facebook.com` or Resumable Upload API) — `file_url` or upload session, `title`, `description`.
- **Reels:** `POST /{page-id}/video_reels` two-phase: `upload_phase=start` → `video_id` + `upload_url` → upload binary/`file_url` header to `rupload.facebook.com` → `upload_phase=finish` with `video_state=PUBLISHED|SCHEDULED|DRAFT` + `description`. Specs: 9:16, min 540×960 (1080×1920 recommended), 3–90s, 24–60fps, H.264/H.265 MP4. Poll `GET /{video-id}?fields=status`.

### Native scheduling — YES
- Feed posts: `published=false` + `scheduled_publish_time` (unix/ISO8601), window **10 min – 30 days**
- Videos: `scheduled_publish_time`, window up to **6 months**
- Reels: `video_state=SCHEDULED` + `scheduled_publish_time` (~30 days)
- Photos: `scheduled_publish_time` supported (not with `temporary=true`)

### Limits
No documented posts/day cap. BUC: Page/system token = 4800 × engaged users per 24h. Error code 32 = Pages throttle.

Docs: [Pages posts](https://developers.facebook.com/docs/pages-api/posts), [Video publishing](https://developers.facebook.com/docs/video-api/guides/publishing), [Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing), [Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/), [Page videos](https://developers.facebook.com/docs/graph-api/reference/page/videos/)

---

## 3. Threads

### Completely separate stack
Threads requires its **own Meta app** with the "Threads use case" — own App ID/secret, own OAuth, own host. Plan for a dedicated app + its own App Review. (Community consensus is the Threads use case can't combine with other products in one app — unverified but strongly implied.) Works with any Threads profile — no business-account requirement.

### Access
App Review on:
- `threads_basic` (mandatory)
- `threads_content_publish`
- Optional: `threads_location_tagging`, `threads_manage_insights` (only if offering those features)

Configure redirect URIs + Deauthorize callback + Data Deletion Request URL in the use case's OAuth settings.

### OAuth / tokens
- Authorize: `https://threads.net/oauth/authorize` → token: `https://graph.threads.net/oauth/access_token`
- Short-lived 1h → long-lived 60d: `GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=...`
- Refresh: `GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token` (≥24h old, unexpired; ~50-day cron)

### Publishing flow (same container model, host `graph.threads.net`)
1. `POST /{threads-user-id}/threads` (container) — recommended ~30s wait or poll `GET /{container-id}?fields=status` (≤1×/min, ≤5 min)
2. `POST /{threads-user-id}/threads_publish?creation_id=...`
3. Containers expire after 24h.

Content types:
- **Text:** `media_type=TEXT` + `text` (≤500 chars). Shortcut: `auto_publish_text=true` publishes text in one call (June 2025; auto-publish, NOT scheduling).
- **Image:** `media_type=IMAGE` + `image_url`. JPEG or PNG, ≤8 MB, width 320–1440px, aspect ≤10:1.
- **Video:** `media_type=VIDEO` + `video_url`. MP4/MOV, H.264/HEVC + AAC, ≤300s, ≤1 GB, ≤1920×1920, 23–60fps.
- **Carousel:** children `is_carousel_item=true` → `media_type=CAROUSEL` + `children` → publish.
- Rich options: `reply_control`, `reply_to_id`, `quote_post_id`, `link_attachment` (≤5 URLs, text posts), `gif_attachment`, `topic_tag`, `poll_attachment`, `location_id`, `alt_text`, `is_spoiler_media`, `is_ghost_post` (24h ephemeral), `enable_reply_approvals`, `crossreshare_to_ig` (share to linked IG Story — needs `threads_share_to_instagram`), `allowlisted_country_codes`.

### Limits
Per account per 24h: **250 posts** (carousel = 1), 1,000 replies, 100 deletions. Query live: `GET /{threads-user-id}/threads_publishing_limit?fields=quota_usage,config`. Media error codes: FAILED_DOWNLOADING_VIDEO, FAILED_PROCESSING_VIDEO, INVALID_ASPECT_RATIO, INVALID_DURATION, INVALID_BIT_RATE, INVALID_FRAME_RATE, INVALID_AUDIO_CHANNELS.

No native scheduling — server publishes at time T.

Docs: [Threads API](https://developers.facebook.com/docs/threads), [Posts](https://developers.facebook.com/docs/threads/posts), [Publishing reference](https://developers.facebook.com/docs/threads/reference/publishing/), [Long-lived tokens](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens), [Changelog](https://developers.facebook.com/docs/threads/changelog/), [Threads use case](https://developers.facebook.com/docs/development/create-an-app/threads-use-case/)

---

## 4. YouTube

### API
YouTube Data API v3: `POST https://www.googleapis.com/upload/youtube/v3/videos` (`uploadType=resumable`, `part=snippet,status`) → session URI in `Location` header → chunked PUT with `308 Resume Incomplete` recovery. Max 256 GB.

Scope: `https://www.googleapis.com/auth/youtube.upload` (narrowest — request this one).

Settable at insert: `snippet.title` (≤100 chars), `snippet.description` (≤5,000 bytes), `snippet.tags[]` (≤500 chars total), `snippet.categoryId`, `status.privacyStatus`, `status.publishAt`, `status.selfDeclaredMadeForKids`, `status.containsSyntheticMedia` (AI disclosure, Oct 2024), `recordingDetails.recordingDate`.

### TWO separate approvals — both required, start immediately
1. **Google OAuth app verification** (Cloud Console). `youtube.upload` is a **sensitive** scope, not restricted → standard verification, **no CASA security assessment**. Requires: privacy policy hosted on the app's domain, domain verification via Search Console, unlisted YouTube demo video of the consent flow (app name + client ID visible) and each scope in use, per-scope justification. Official "up to 10 days"; realistically 2–6 weeks.
   - **Killer gotcha:** while the OAuth app is in "Testing" status, **refresh tokens expire after 7 days** — stored user connections die weekly. Must move to "In production." Once verified + in production: refresh tokens persist indefinitely if used every 6 months (50-token cap per user/client).
2. **YouTube API Services compliance audit.** Unaudited projects (created after Jul 28, 2020) have **all uploads forced to private**. Videos locked private **cannot be unlocked** — only re-uploaded post-audit. Apply: [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form). Timeline: community reports range weeks to ~5 months. Denial patterns: vague use case, missing privacy policy, scraper-like behavior. Note: access can be revoked after 90 days of inactivity.

### Quota — June 2026 restructure (old "6 uploads/day" is obsolete)
- Dec 4, 2025: upload cost cut ~1,600 → ~100 units. June 1, 2026: per-method buckets.
- **Current default: 100 `videos.insert` calls/day** (own bucket) + 100 `search.list`/day + 10,000 units/day for everything else. Resets midnight Pacific.
- `videos.update` = 50 units, `thumbnails.set` = 50, `playlistItems.insert` = 50 (shared pool).
- Increases: same audit/extension form; ceilings negotiated, not published. Strategy: launch within defaults, apply with real usage data.

### Native scheduling — YES
`status.privacyStatus="private"` + `status.publishAt=<ISO 8601>` at insert; YouTube flips public at that time. Rules: video must never have been published; past datetime ≈ publish now; when setting `publishAt` via `videos.update`, re-send `privacyStatus:"private"`. Upload anytime, let YouTube handle the flip.

### Shorts
No separate API/flag. Automatic classification: square/vertical aspect AND ≤3 min (uploads on/after Oct 15, 2024). `#Shorts` hashtag not required. A vertical ≤3 min video **cannot opt out** of Shorts classification. Caveats: Shorts >1 min with a Content ID claim are blocked globally; custom thumbnails generally don't display in the Shorts feed (unofficial).

### Thumbnails
`POST .../thumbnails/set?videoId={id}` — ≤2 MB JPEG/PNG. Fails unless the channel has phone verification / intermediate features (surfaced as an API error).

Docs: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [Resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [Quota costs](https://developers.google.com/youtube/v3/determine_quota_cost), [Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits), [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Shorts classification](https://support.google.com/youtube/answer/15424877)

---

## 5. LinkedIn

### Two destinations, two access models
**Important:** "member profile" = each connected user's own LinkedIn profile (3-legged OAuth, posts on their behalf) — not just the developer's account. This is the bulk of scheduler usage and it's self-serve.

| | Member profiles (users' own profiles) | Company Pages (post as an org) |
|---|---|---|
| Product | **Share on LinkedIn** + Sign In with LinkedIn (OpenID Connect) | **Community Management API** |
| Access | **Self-serve** — add products in Developer Portal, no review | Application: open to approved developers (no longer invite-only), but vetted |
| Scope | `w_member_social` (+ `openid profile` for the person URN via `/v2/userinfo` → `sub`) | `w_organization_social` (+ `r_organization_social`, `rw_organization_admin`; posting requires page role ADMINISTRATOR / CONTENT_ADMIN / DSC_POSTER) |
| Ship date | Today | After approval |

**Community Management application:** requires a registered legal entity, verified business email (personal emails fail), legal name/address/website, privacy policy, and app verification by a **super admin of the company's LinkedIn Page**. Lands in **Development tier** (500 calls/app/day, 100 calls/member/day, 12 months to integrate) → **Standard tier** upgrade via second form + **screencast** demoing every claimed use case. **Rejection is one-shot per app** — reapplying requires a brand-new app. LinkedIn reserves discretion. No official SLA; anecdotes say 3–6 months (unverified). `r_member_social` (reading member posts) is closed to new requests.

### Posts API (versioned — the forward-compatible path)
- `POST https://api.linkedin.com/rest/posts`
- Headers: `LinkedIn-Version: 202606` (YYYYMM; each version supported ~1 year — bump periodically), `X-Restli-Protocol-Version: 2.0.0`, `Authorization: Bearer`
- Text post body: `{"author": "urn:li:person:{id}" | "urn:li:organization:{id}", "commentary": "...", "visibility": "PUBLIC", "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [], "thirdPartyDistributionChannels": []}, "lifecycleState": "PUBLISHED", "isReshareDisabledByAuthor": false}` → 201, post URN in `x-restli-id` header
- **Images:** `POST /rest/images?action=initializeUpload` `{initializeUploadRequest: {owner: <urn>}}` → `uploadUrl` + `urn:li:image:{id}` → PUT binary → reference in `content.media.id` (+ `altText`). Limits: <36,152,320 px; JPG/PNG/GIF (≤250 frames).
- **Video:** `POST /rest/videos?action=initializeUpload` with `fileSizeBytes` → multipart `uploadInstructions` (4 MB parts) + `uploadToken` → upload parts (keep ETags) → `?action=finalizeUpload` → poll `GET /rest/videos/{urn}` for `status: AVAILABLE` before posting. Specs: 3s–30min, 75 KB–500 MB MP4.
- **Multi-image:** organic-only via `content.multiImage`. Carousels are sponsored-only. Articles need explicit `content.article.{source,title,description,thumbnail}`.
- Mentions: `@[Name](urn:li:organization:2414183)` little-text format in `commentary`.
- Legacy `v2/ugcPosts` still works for self-serve member posting but is a deprecated-track surface; prefer `/rest/posts` (it accepts `w_member_social`).

### Tokens & limits
- Access token **60 days**. **Refresh tokens only for approved Marketing/Community partners** (365-day refresh window, fixed from initial auth). **Self-serve apps get NO refresh token → users must re-OAuth every ≤60 days. Build the "reconnect LinkedIn" nudge from day one.**
- Rate limits: **150 requests/day/member**, 100,000/day/app (documented on the legacy share surface; per-app actuals shown in Developer Portal → Analytics). Unpublished duplicate-content check — identical text posted twice will fail.
- No native scheduling (`lifecycleState: PUBLISHED` is the only accepted create value) — server publishes at time T.

Docs: [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin), [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), [Community Management review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review), [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)

---

## 6. Pinterest

### Access tiers — the critical detail
- Create the app via "Connect app" on developers.pinterest.com (requires a Pinterest **business account**). Trial requests reviewed each business day.
- **Trial access = SANDBOX: pins/boards created are visible only to their creator.** Not real distribution — don't mistake trial publishing for launch-ready.
- **Standard access** = real publishing. Upgrade via My Apps → Upgrade with a **video of your app completing an action via the API** (they check the OAuth flow is proper). Review takes "a few days." Both tiers free.

### OAuth / tokens
- Scopes for a scheduler: `pins:read pins:write boards:read boards:write user_accounts:read`
- Token endpoint: `POST https://api.pinterest.com/v5/oauth/token`
- **Access token 30 days**; **refresh token 60 days, rotated on every refresh, refreshable indefinitely** (continuous-refresh model only; the legacy 365-day model is gone). Refresh before expiry or the user must re-OAuth.

### Publishing
- **Create pin:** `POST https://api.pinterest.com/v5/pins` — `board_id` (required), `media_source` (required), `title`, `description`, `link`, `alt_text`, `board_section_id`.
- `media_source.source_type`: `image_url`, `image_base64`, `multiple_image_urls` / `multiple_image_base64` (carousel), `video_id`, `pin_url`.
- **Video:** `POST /v5/media {"media_type":"video"}` → `media_id` + `upload_url` + `upload_parameters` → multipart POST file (.mp4/.mov/.m4v) to `upload_url` (no Bearer) → poll `GET /v5/media/{media_id}` until `succeeded` → create pin with `source_type: video_id` + required cover image (`cover_image_url` / `cover_image_data` / `cover_image_key_frame_time`).
- **Boards:** `POST /v5/boards`, `GET /v5/boards` (scopes `boards:read`+`boards:write`).

### Limits
- Trial: 1,000 requests/day/app total; `org_write` 300/day.
- Standard: `org_write` (pin/board creation) **100/min/user**; `org_read` 1,000/min; universal ceiling 100 req/s/user/app. No documented daily pin cap (spam systems can still throttle aggressive accounts — unverified numerically).
- No native scheduling in the API (Pinterest's UI scheduler is not exposed) — server publishes at time T.

Docs: [API docs](https://developers.pinterest.com/docs/api/v5/), [Create pin](https://developers.pinterest.com/docs/api/v5/pins-create/), [Media upload](https://developers.pinterest.com/docs/api-features/creating-boards-and-pins/), [Rate limits](https://developers.pinterest.com/docs/reference/ratelimits/)

---

## 7. Reddit

### Access model — changed Nov 2025
**Responsible Builder Policy:** self-serve app creation is gone for new apps. "You must request access and get explicit approval before accessing any Reddit data through our API."
- Apply via [this ticket form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164) (developer category; describe use case, data needed, subreddits, expected volume).
- **Commercial use requires explicit written approval + a contract.** Reddit defines commercial as any use "by a business or... as part of a monetized product or service" — a paid scheduler is unambiguously commercial. Reported (unofficial): ~$0.24/1k calls enterprise pricing, 2–4 week approvals.
- Policy bans: masking access purpose, multiple accounts for one use case, "spamming activity through automated posts," ML training on Reddit data. Enforcement: token revocation, suspension.

### OAuth / tokens
- Scopes: `identity`, `submit`, `read`, `flair`
- Authorize: `https://www.reddit.com/api/v1/authorize`; token: `.../api/v1/access_token`
- Access tokens **1 hour**; request **`duration=permanent`** → permanent refresh token (rotates on each refresh since 2021 — persist the new one every time)
- Mandatory User-Agent format: `<platform>:<app ID>:<version> (by /u/<username>)`

### Posting
- `POST /api/submit` — `api_type=json`, `sr` (subreddit; use `u_{username}` for user-profile posts), `title` (≤300), `kind` ∈ `self` | `link` | `image` | `video` | `videogif`, `url` / `text` (markdown) or `richtext_json`, `flair_id` (≤36) / `flair_text` (≤64), `nsfw`, `spoiler`, `sendreplies`, `resubmit`, `video_poster_url` (required thumbnail for video).
- **Media upload is undocumented/unofficial:** the real-world flow (PRAW's) is `POST /api/media/asset.js` (filepath+mimetype) → S3 lease → POST file to S3 → use asset URL in `/api/submit`. Galleries via undocumented `POST /api/submit_gallery_post.json`. Treat as unstable.
- **Video is janky (confirmed):** the created-post URL returns over a **websocket** (`websocket_url`) that often fails while the post still gets created. Build idempotency: on websocket failure, check `/user/{name}/submitted` before retrying.
- **Flair:** `POST /api/flairselector` or `GET /r/{sub}/api/link_flair_v2`; some subs require flair (`SUBMIT_VALIDATION_FLAIR_REQUIRED`).

### Limits & gotchas
- Free tier: **100 queries/min per OAuth client** (10-min averaging window); monitor `X-Ratelimit-*` headers. Non-OAuth traffic blocked.
- Per-account throttles: low-karma accounts hit "you're doing that too much" cooldowns (~10–15 min); subreddit karma/age requirements and AutoModerator silently remove posts — there's no API to read a sub's requirements. Handle `RATELIMIT` and `SUBREDDIT_NOTALLOWED`; surface removals to users.
- No native scheduling (Reddit's scheduled posts are a mod-only tool) — server publishes at time T.

Docs: [API reference](https://www.reddit.com/dev/api/), [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564), [Access request form](https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164)

---

## 8. Snapchat

### The API exists — access is the problem
The **Public Profile API** (under the Marketing API umbrella) is the official server-side organic posting surface: **Stories, Saved Stories, Spotlight** on behalf of brands/creators, plus analytics. It's what powers **Later** (partnership, Feb 2025) and **Sprout Social** (June 2026). Buffer and Hootsuite have no Snapchat posting as of July 2026.

**Not** to be confused with: Creative Kit (mobile SDK, user-initiated sharing into Snapchat — no server posting), Marketing/Ads API (paid ads — open access), Conversions API (event tracking).

### Access — allowlist only
- Docs state the API is **"currently allowlist only."** No self-serve form exists.
- Prerequisites: Snapchat account, **Snap Business Account (Organization)**, and an OAuth app created in **Ads Manager (ads.snapchat.com) → Business Dashboard → Business Details → OAuth Apps**. ⚠️ **Do NOT create the OAuth app in the Developer Portal — those Client IDs do not work with the Public Profile API.**
- Allowlisting = emailing your **Snap point of contact** the client ID (never the secret) + use-case description. Getting that contact is the gate: go through Snap business support/sales with the SMM-tool pitch. Later framed theirs as a formal partnership; expect a BD conversation, not a form. Timeline unpublished.
- Interim option: resell via an already-allowlisted aggregator (e.g. Ayrshare) until direct access lands.
- Connected users must have a Snapchat **Public Profile** (free to create in-app; business or creator).

### OAuth
- Authorize: `https://accounts.snapchat.com/login/oauth2/authorize?response_type=code&client_id={id}&redirect_uri={uri}&scope=snapchat-profile-api&state={state}`
- Token: `POST https://accounts.snapchat.com/login/oauth2/access_token` — access tokens 1h + refresh tokens
- Scope: `snapchat-profile-api`

### Publishing flow (host `businessapi.snapchat.com`)
1. **Create media container:** `POST /v1/public_profiles/{profile_id}/media` with `type` (VIDEO|IMAGE), `name`, and a client-generated **AES-256-CBC key (base64 32-byte `key`) + IV (base64 16-byte `iv`)** — you encrypt the file yourself before upload. Returns `media_id`, `add_path`, `finalize_path`.
2. **Upload:** `POST {add_path}` with `action="ADD"`, file part, `part_number` (1–35; multipart required >32 MB; **max 1 GB**), then `POST {finalize_path}` with `action="FINALIZE"`.
3. **Publish:**
   - Story: `POST /v1/public_profiles/{profile_id}/stories {"media_id": "..."}`
   - Spotlight: `POST /v1/public_profiles/{profile_id}/spotlights {"media_id": "...", "description": "...", "locale": "en_US"}`
   - Saved Story: `POST /v1/public_profiles/{profile_id}/saved_stories {"saved_stories": [{"title": "...", "snap_sources": [...]}]}`

### Specs & gotchas
- Story video 5–60s; Spotlight video 6–60s, **video-only**, min 540×960 (9:16). Images (JPEG/PNG) for Stories/Saved Stories. Third-party reported: image ≤20 MB, video ≤500 MB (unverified officially).
- **Uploaded media expires 24h after creation** — upload near publish time.
- Hashtags clickable in Spotlight descriptions; @mentions render as plain text (unofficial).
- Rate limits not published. No native scheduling — server publishes at time T.

Docs: [Introduction](https://developers.snap.com/marketing-api/Public-Profile-API/Introduction), [Get Started (OAuth + allowlist)](https://developers.snap.com/marketing-api/Public-Profile-API/GetStarted), [Asset Management (endpoints)](https://developers.snap.com/api/marketing-api/Public-Profile-API/ProfileAssetManagement), [Marketing API access](https://businesshelp.snapchat.com/s/article/api-apply)

---

## 9. Meta App Review checklist

Business verification is done ✅. Standard Access only covers accounts with roles on the app; serving external users requires **Advanced Access per permission** = App Review, and the app must be in **Live mode**.

Permissions to request (only these — unused scopes are the #1 rejection reason):
- **IG+FB app:** `instagram_business_basic`, `instagram_business_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` (+ `publish_video` only if demoing FB video)
- **Threads app (separate submission):** `threads_basic`, `threads_content_publish`

Submission requirements:
1. **Screencast per permission** — the complete end-to-end journey in the real Posterract UI: login → Meta consent dialog → compose/schedule → post appearing live on the platform. Static screenshots are no longer accepted. Annotate which permission powers each step.
2. **Working test credentials** + step-by-step instructions; app reachable at a public URL (not localhost), test account populated.
3. **Privacy Policy URL** in app settings.
4. **Data deletion:** callback URL (receives signed_request POST, returns `{url, confirmation_code}`) or an instructions page. Threads also wants Deauthorize + Data Deletion URLs in its OAuth settings.
5. App icon 1024×1024, category, business email; app associated with the verified Business.
6. Reviewer-accessible test accounts (Instagram Testers / Threads Testers roles help during dev).

Timeline: no official SLA; observed 2–7 business days per round, up to 2–4 weeks in spikes. Plan 2–3 rounds. Common rejections: scopes not visibly used in the screencast; screencast shows API calls but not user-facing value; reviewers can't log in; inadequate privacy policy; requesting `business_management`/messaging scopes "just in case."

---

## 10. Cross-platform architecture notes

- **Scheduler engine:** server holds post → publishes at time T (existing TikTok pattern) works everywhere; only FB (`scheduled_publish_time`) and YouTube (`status.publishAt`) offer native alternatives. Consider native for YouTube (uploads are heavy; upload once at schedule time, let YouTube flip visibility).
- **Publish-time-only artifacts:** IG containers, Threads containers, and Snap media uploads all **expire in 24h** — create/upload at publish time, never at schedule time.
- **Public media URLs:** Meta/Threads fetch media from a publicly accessible URL — media storage must serve unauthenticated (or signed, long-enough-lived) URLs.
- **Token refresh cron:** IG 60d (refresh ~day 50) · Threads 60d (~day 50) · Pinterest 60d rotating (refresh well before) · Reddit rotating-on-use (persist each new refresh token) · YouTube indefinite once verified + in production (but 7-day expiry while in Testing) · LinkedIn self-serve **no refresh** → user re-auth nudge every ≤60 days · FB Page tokens no expiry · Snap 1h access + refresh.
- **Quota polling:** IG `content_publishing_limit` and Threads `threads_publishing_limit` should be checked before publish to fail gracefully.
- **Per-account daily caps to enforce app-side:** IG 50–100, Threads 250, LinkedIn 150, YouTube ~100/project (not per user — project-wide!). YouTube's project-wide bucket means upload volume needs monitoring + a quota-extension request as usage grows.
- **Account-type prerequisites to surface in onboarding:** IG professional account · FB Page with CREATE_CONTENT task · Snapchat Public Profile · LinkedIn page super-admin (for org posting) · Reddit karma/subreddit rules.

## 11. Flagged uncertainties (re-verify before relying on)

- IG daily publish quota: 100 (guide) vs 50 (reference) — query the endpoint per account.
- Threads use-case app exclusivity (dedicated app strongly implied, not explicitly documented).
- Alleged 2025 "200 calls/hr per IG account" cut — third-party blogs only, not in official docs.
- `publish_video` requirement for FB Page video posts — docs inconsistent.
- All review/approval timelines (Meta, YouTube audit, LinkedIn CM, Reddit, Snap) — anecdotal, no published SLAs.
- Snap rate limits and exact media size caps — not officially published.
- Reddit enterprise pricing (~$0.24/1k), grandfathering, token-lifetime specifics — third-party sourced.
- Shorts + `thumbnails.set` behavior — not officially documented.
