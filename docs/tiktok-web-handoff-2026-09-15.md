# Posterract web — TikTok Direct Post handoff

Scope: the website and its PostgreSQL/Temporal publishing backend. No desktop build, packaging, Git commit, or push.

## What was built

- Create Post → **Accounts** shows destinations, profile details and connection state. One account per platform; multiple connected accounts require a choice. Account Sets populate those exact account IDs, and individual edits switch to Custom.
- **TikTok Settings** appears below Accounts. New web posts default to Post directly; Send to TikTok inbox remains available. Older submissions without a mode still use inbox delivery.
- Direct Post fetches current creator information, starts with empty privacy and unchecked interactions, respects disabled interactions and account duration limits, and includes commercial disclosure and AI-content settings.
- The final action displays the destinations, processing notice and linked music declaration, plus Branded Content Policy when applicable. Scheduling saves those choices; the server records the authenticated actor, account and authorization time.
- A Direct Post duplicate opens Create Post for review, with privacy and authorization reset; it is not automatically scheduled.
- The worker prepares the video, serves a signed two-hour media URL from the existing website, and initializes Direct Post using PULL_FROM_URL. GET, HEAD and byte ranges are supported without redirects. The cleanup cycle removes expired prepared media.
- A separate, version-gated Temporal workflow persists the publish ID and polls durably. Known publish IDs are resumed; an ambiguous initialization stops re-upload to avoid duplicates. Private completion counts as published even without a public URL. Posting points are idempotent. Public IDs arriving later are reconciled during analytics refresh.

## Verification

- Web typecheck and production build: passed (existing large-chunk warning remains).
- Contract typecheck and API/worker syntax checks: passed.
- API suite: 63 tests passed, including new workspace isolation, settings validation, signed media, Direct Post sessions and late media-preparation recovery tests.
- Worker connector suite: 7 tests passed, including the 3 existing inbox-upload tests.
- Focused isolated Chromium tests: 8 passed, covering account selection/sets, account switching, disclosure, scheduling, duplication, inbox mode and the existing web product loop.
- Temporal workflow bundle: built successfully.
- TikTok responses in automated tests were simulated. **No real TikTok post was created for these tests.**
- Production release: deployed to the existing VPS on September 15, 2026; only `web`, `api` and `orchestrator` were rebuilt/recreated. Migration `016-tiktok-direct-post.sql` applied successfully.
- All three services are healthy. Internal and public readiness report PostgreSQL, Redis, Elasticsearch, Temporal and configured R2 healthy. The public composer bundle contains Accounts, Direct Post, privacy and the linked declaration.
- Live signed-media smoke test passed: GET 200, HEAD 200, byte-range GET 206, no redirects. The temporary test object and session were removed. The creator-info endpoint rejects unauthenticated access (401), and unsigned media access is rejected (403).
- Sanitized startup/service logs showed the API listening and the worker running, with no error entries in the reviewed window.
- The workflow replay checker connected and bundled successfully, but no retained `publicationWorkflow` histories were available to replay. Compatibility is implemented with the Temporal patch gate; historical replay is not claimed as a completed test.

Release files are explicitly listed in `deploy/posterract/tiktok-web-files.txt`; no secrets, unrelated source changes, or desktop files were synced. Rollback source archive: `/srv/posterract/backups/tiktok-web-before-20260915-2242.tar.gz`. Previous service images are retained with the `before-tiktok-20260915` tag. The additive table can remain in place if rolling back application images.

## Your remaining steps

1. Open the existing **Live** app in [TikTok for Developers](https://developers.tiktok.com/). Keep the existing app and approved scopes; this is the Direct Post audit reapplication, not a new app or sandbox setup.
2. Domain verification is already complete, as confirmed by the founder. No repeat verification or new domain is needed. The existing media endpoint remains `https://www.posterract.app/v1/tiktok/media/`.
3. Open [Posterract Create Post](https://www.posterract.app/compose) in a normal browser window. Keep the address bar visible, and show the full `https://www.posterract.app/...` address in the recording. The URL belongs in the browser chrome, not as a watermark added to the uploaded video.
4. Use your connected account and a short original video. Select the exact account, choose Post directly, manually select privacy, review the caption/settings/declaration and click Publish now. Wait for TikTok-confirmed publication, then open the actual resulting video on TikTok while signed into that same account. **Do not end the demo at “processing” or an inbox notification.**
5. If TikTok returns its unaudited-client restriction, follow its required test-account/privacy settings: current documentation limits unaudited clients to private accounts and Only me posts. This is a TikTok-side restriction, not an approval blocker added to Posterract. A private post can succeed without a public link; open it from your own TikTok profile. [Current unaudited limits](https://developers.tiktok.com/docs/en/content-sharing-guidelines)
6. Record the flow below, add the scope explanations, and use **Content Posting API → Direct Post → Reapply** in the existing Live app. Approval and increased access remain TikTok's decision. [Review requirements](https://developers.tiktok.com/docs/en/app-review-guidelines)

## Recording script tied to the finished screens

Use real screens, your real connected account, and a real post result. Do not expose API secrets, access tokens or signed media URLs.

1. **Website and connection:** show the full Posterract URL, introduce it as a creator-facing publishing/scheduling product, then show Social accounts/Portals and the authorized TikTok account. Demonstrate the real connect/authorization flow if the reviewer requires it; do not disconnect an account with pending jobs just to manufacture a recording.
2. **Create Post:** upload/select your original video. Play the preview. Edit the caption/hashtags. Show Accounts and the destination account's nickname/handle; if you have multiple accounts, show the selector.
3. **TikTok Settings:** show Post directly and the initially empty privacy choice. Show unchecked interaction controls and any greyed-out restrictions. Manually choose an available audience.
4. **Commercial controls:** demonstrate that enabling disclosure requires Your brand and/or Branded content. Show the promotional/paid-partnership explanation and that branded content cannot be private. Show the policy declaration changing. Reset this to the truthful disclosure for the actual demo video before publishing; do not submit a false branded-content declaration merely to demonstrate the controls.
5. **Authorization and publication:** show the AI setting, selected destinations, linked music declaration and processing notice. Click Publish now. Show the real processing/completion status in the posts list. Open the actual uploaded video on TikTok and show the matching account and content. This is the key ending requested in the rejection.
6. **Remaining retained scopes:** add a short segment showing Send to TikTok inbox → actual TikTok inbox delivery/finishing flow for `video.upload`, and Analytics with real account/public-video metrics for the read scopes. Explain any empty metrics honestly; do not use demo-mode statistics as real account data.

## Scope explanations for the existing application

| Scope | Accurate explanation | Demonstration |
| --- | --- | --- |
| `user.info.basic` | Reads the authorized TikTok user's basic identity and profile image so Posterract can identify the connected destination account. | Connection and account identity on Social accounts/Create Post. |
| `video.publish` | Publishes the creator's selected original video directly to their own TikTok account after they choose audience/interactions/disclosures and authorize publishing or scheduling. | Direct Post settings, explicit final action, processing status, and actual posted video on TikTok. |
| `video.upload` | Provides the separate Send to TikTok inbox mode so the creator can continue editing and finish publishing within TikTok. | Inbox mode and actual notification/draft on TikTok. Do not describe this as completed Direct Post. |
| `user.info.stats` | Reads authorized account statistics such as follower/following, likes and video counts for the creator's analytics dashboard. | Real TikTok account statistics in Analytics. These are not supplied by `user.info.basic`. |
| `video.list` | Reads public-video metadata and counters for the authorized creator's videos tracked in Posterract, allowing video-level performance reporting. | Real public-video rows/counters in Analytics. Private-only Direct Post tests may not supply public-video analytics. |

Suggested Direct Post explanation:

> Posterract lets creators publish and schedule their own original videos to accounts they connect. On the web Create Post screen, the creator selects the exact TikTok account, previews the video, edits the caption, selects privacy and available interactions, and provides commercial-content/AI disclosures. The creator explicitly authorizes the displayed post and settings with Publish now or Schedule post. Posterract checks current TikTok creator permissions, transfers the video through a verified-domain media URL, and displays TikTok's processing and publication result. A separate inbox-upload mode remains available for creators who want to finish inside TikTok.

Before submitting: confirm that the website URL/domain in the application matches the recording, links to terms/privacy work, each selected scope has a truthful explanation/demo, and the recording ends with an actual TikTok post. The [required UX checklist](https://developers.tiktok.com/docs/en/content-sharing-guidelines) must be demonstrated with real product screens and results. Automated checks do not establish that a real TikTok publication or the review itself will succeed.

## September 16 follow-up: review corrections

- Creator daily-post caps, the app's daily active-creator cap, and creator posting restrictions are distinguished from temporary HTTP 429/request-rate throttling. The former stop the publishing attempt and display a clear try-later explanation; temporary throttling retains the existing retry behavior. The same explanation reaches both Create Post and the publishing-status UI.
- Missing commercial-disclosure choices now explain the disabled Publish now / Schedule post action on hover and keyboard focus. The unavailable Only me choice also explains the branded-content restriction on hover and keyboard navigation. The disabled Branded content checkbox retains its inline explanation and also has an accessible hover/focus explanation.
- The privacy dropdown retains its position, colors, empty default, and creator-provided choices. Its popup uses web-rendered options because browser-native disabled select options do not reliably expose hover events. Invalid options cannot be selected by mouse or keyboard.
- Regression checks: 66 API tests, 8 worker connector tests, and 10 isolated web tests passed. Web typechecking/build and API/worker syntax checks passed. The first web run caught a mistaken test locator; it was corrected and the complete focused web suite then passed. No real TikTok post was sent.
- This follow-up changes five production source files only, listed in `deploy/posterract/tiktok-review-fix-files.txt`. No database migration, OAuth-scope change, desktop build, Git commit, or push is involved.
- Deployed September 16 to the existing VPS after targeted dry-run/sync and rebuilding only web, API, and orchestrator. All three services are healthy; internal/public readiness passed. The served `assets/compose-B3vADgfo.js` bundle contains both tooltip messages and the accessible privacy popup. A checksum comparison found no remaining differences in the five release files.
- Follow-up rollback source: `/srv/posterract/backups/tiktok-review-fix-before-20260916T190309Z.tar.gz`. Each previous service image is tagged `posterract-<service>:before-review-fix-20260916T190309Z`.
