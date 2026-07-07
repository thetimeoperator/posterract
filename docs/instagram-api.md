# Instagram API — Instagram Login variant (verified from Meta docs, July 2026)

App: "Manage messaging and content on Instagram" use case = **Instagram API with
Instagram Login** (graph.instagram.com host, NOT Facebook Login / Pages).
Requires an Instagram **Professional** (Business/Creator) account. No Facebook
Page link required for this variant.

Credentials in Convex env: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`.
Redirect URI (registered in the app): `${SITE_URL}/oauth/callback/instagram` → `https://www.posterract.app/oauth/callback/instagram`.

## OAuth
- **Authorize:** `GET https://www.instagram.com/oauth/authorize`
  params: `client_id`, `redirect_uri`, `response_type=code`, `scope` (comma-sep), `state`
- **Scopes (this variant):** `instagram_business_basic`, `instagram_business_content_publish`,
  `instagram_business_manage_messages`, `instagram_business_manage_comments`.
  (Insights scope name to confirm at gamification build — request posting scopes only for now.)
- **Short-lived token:** `POST https://api.instagram.com/oauth/access_token`
  body (form): `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`
  → returns `{ access_token, user_id, permissions }`
- **Long-lived token (60d):** `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<short>`
  → `{ access_token, token_type, expires_in }`
- **Refresh (60d, token ≥24h old):** `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long>`
- **Profile:** `GET https://graph.instagram.com/me?fields=user_id,username&access_token=...`

## Publish a Reel (video)
API version constant `v23.0`. Video must be at a public URL (Convex storage URL works).
1. **Container:** `POST https://graph.instagram.com/v23.0/<IG_ID>/media`
   params: `media_type=REELS`, `video_url`, `caption`, `access_token` → `{ id: containerId }`
2. **Poll status:** `GET https://graph.instagram.com/v23.0/<CONTAINER_ID>?fields=status_code&access_token=...`
   status_code ∈ `IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED`. Publish only when `FINISHED`.
3. **Publish:** `POST https://graph.instagram.com/v23.0/<IG_ID>/media_publish`
   params: `creation_id=<containerId>`, `access_token` → `{ id: mediaId }`
4. Permalink: `GET https://graph.instagram.com/v23.0/<MEDIA_ID>?fields=permalink&access_token=...`

Rate limit: 100 API posts / 24h moving window. Works in Development Mode for
accounts with an app role (i.e. the founder) — no App Review needed for own use.
