**Approved web composer build plan — September 16**

The founder approved the second, conservative layout with these final corrections. This plan supersedes contradictory details in both earlier proposals.

1. Keep Posterract's existing Panel, brackets, colors, type scale, header, dock, inputs, buttons and compact Trajectory / When component. Web only: route desktop to the unchanged original Composer.
2. Start the combined panel with compact account avatars and platform corner badges. Remove THE MESSAGE and Caption headings above Accounts. Keep exact account IDs, account sets, one account per platform, real photos with fallback, and an account-picker dialog for replacements/connections.
3. Place modest media beside the existing one-textarea Base/platform caption tabs. Remove the separate hashtag bar and its state. Users write hashtags directly in their captions. Submit hashtags as an empty array; preserve copied legacy captions (which already include their hashtags) without appending anything again.
4. Place a compact Settings button directly below the caption where the hashtag field was. Open a tabbed platform-settings dialog; changes persist through close/reopen. Preserve actual TikTok behavior and creator constraints; other platforms show supported format information and no invented settings.
5. Move the unchanged compact Trajectory / When panel to the first position on the right. Keep Pre-flight and the existing publish action below it. Remove the repeated Posting as, up-to-duration, destination-summary and processing paragraphs above Publish. Retain the existing TikTok music/branded-content declaration associated with submission.
6. Use one readiness calculation for the visible checks and the submit guard, including missing/disconnected accounts, TikTok requirements and future schedule. Make failed checks open/focus the relevant settings, account picker, caption or time input.
7. Keep all components content-height, with no forced tall panels. Preserve mobile behavior and dock clearance. Scope CSS and dialogs to the web composer. Do not change shared desktop components.
8. Validate typecheck/build and focused browser tests: caption inheritance, inline hashtags exactly once, account replacement/sets, copied posts, modal persistence/keyboard behavior, TikTok rules, invalid schedules, idempotent submission, responsive bounds and original desktop composer. Inspect actual desktop/mobile screenshots before deployment.
9. Compare production source against the starting baseline, back up only touched files, dry-run a targeted sync, deploy only the web service on the VPS, and verify health plus publicly served release assets. No GitHub commit/push and no real social posts during tests.

Implementation files: compose route (entry boundary only); web-only WebComposer, WebAccountStrip, WebPlatformSettings and styles; existing web-only WebTikTokSettings. Tests and this report remain local. Existing unrelated work is preserved.

**Completed and deployed**

- Accounts now lead the combined content-height bracketed panel. Real avatars have platform badges and selected/attention states; broken images fall back to initials. Exact account IDs and account sets are retained.
- Removed the redundant top headings and the separate hashtag field. Hashtags are caption text. Copied legacy posts retain their original hashtags once.
- Settings sits directly below the caption and opens a platform-tabbed modal. Choices survive reopening. The native dialog handles keyboard focus and Escape; nested privacy selection can close without dismissing the dialog.
- The existing compact Trajectory / When component leads the right column. Removed duplicate posting identity, duration, destination and processing notes above Publish. The existing TikTok submission declaration remains.
- Pre-flight and the publish guard use the same requirements, with error links to settings, accounts, captions and schedule.
- Original desktop Composer function verified byte-for-byte unchanged; the desktop browser regression also passes. Shared desktop components were not edited.

Validation: TypeScript check, production build and diff whitespace check passed. Eighteen focused browser checks passed across the product loop, TikTok requirements and composer behavior, including real fixture-video upload/replacement, inline/legacy hashtags, account targeting, mobile bounds and desktop preservation. Three long tests exceeded the 30-second limit during one parallel run and passed when rerun serially with a 60-second limit. Tests used the isolated local demo engine; no real social posts were created. Desktop/mobile screenshots and local browser interaction were reviewed. Mobile right-column alignment was corrected before the final build.

Production: backed up the four replaced source files to `/srv/posterract/backups/composer-before-approved-layout-20260916.tar.gz`; added three web-only component files. Dry-run and sync covered exactly seven source files, preserving remote owner/group/modes and directory timestamps. Only the web service was rebuilt/recreated. Container status is healthy; readiness reports postgres, redis, elasticsearch, temporal and R2 OK. A checksum sync dry-run reports no differences for the release files.

Public verification: `https://posterract.app/` references entry `index-KhKD1TEc.js`, which references deployed `compose-CTWQ1Zz6.js` and `compose-CjkXIjI-.css`. Both public assets were fetched and checked for the new account strip, settings control/dialog and inline-hashtag payload behavior. Authenticated production publishing was not exercised. No cache rules, desktop build, GitHub commit or push were made.

Local logs: `/tmp/posterract-approved-composer-typecheck.log`, `/tmp/posterract-approved-compose-build.log`, `/tmp/posterract-approved-compose-tests.log`, `/tmp/posterract-approved-compose-retry.log`, `/tmp/posterract-approved-compose-deploy.log`. Local review server stopped after verification.

**Founder refinements — completed and deployed September 16**

These corrections supersede the declaration placement described above. Restored the compact Posterract secondary Settings button beneath the caption: removed the full-width treatment and accordion chevron. Added a visible Account set label and selector in the Accounts heading, retaining exact selected account IDs, avatar updates, platform tabs, and the Custom selection state after manual changes. Empty workspaces show No saved sets with Create set; the account picker also links to Manage account sets. Management opens in another tab so the current caption and media remain in place.

Moved the existing music/branded-content declaration into the TikTok direct-post settings tab. It no longer appears above Publish or in the multi-platform confirmation, on other platform tabs, or for TikTok inbox delivery. Publishing validation and existing desktop components remain unchanged.

Validation: TypeScript check, production build, whitespace check, and all 19 focused browser tests passed. Tests cover the compact button, empty/populated account sets, exact targeting through scheduling, declaration placement, mobile bounds, and unchanged desktop behavior. The first run exposed an exact-label lookup issue with a nested select; the final implementation uses an explicit label/input association and the full suite passed. Desktop, mobile, and populated account-set screenshots were inspected. All publishing tests used the isolated demo engine; no real social posts were sent. Original desktop Composer remains byte-for-byte unchanged.

Deployment: dry-run and checksum verification covered only WebComposer.tsx, WebAccountStrip.tsx, WebTikTokSettings.tsx and web-composer.css. Previous files are backed up at `/srv/posterract/backups/composer-before-account-set-refinement-20260916.tar.gz`. Rebuilt/recreated only web on the VPS; container is healthy and readiness reports every service and R2 OK. Public entry `index--VArYwbu.js` references `compose-CNOsKgwE.js` and `compose-LnkLE2b8.css`; fetched both from posterract.app and verified the account-set UI, declaration container, and compact button style. Authenticated production publishing was not exercised. No desktop release or GitHub commit/push.

Logs: `/tmp/posterract-composer-refinements-tests-final.log`, `/tmp/posterract-composer-refinements-typecheck.log`, `/tmp/posterract-composer-refinements-build.log`, `/tmp/posterract-composer-refinements-deploy.log`.

**TikTok default audience — deployed September 16**

At the founder's request, the web composer now selects Everyone automatically once the selected TikTok account confirms PUBLIC_TO_EVERYONE is available. A user-selected audience survives closing/reopening settings and refreshing creator information. Refresh keeps the original reset behavior for the other TikTok options. Switching accounts and creating/copied posts applies the default against that account's capabilities. If public posting is unavailable, the selector offers the account's supported audiences and pre-flight still blocks an incomplete choice. Shared contract and desktop behavior are unchanged.

Validation: all 21 composer/product-loop/TikTok browser tests passed, including a new default-payload test that never opens settings and a restricted-account fixture. After narrowing refresh to preserve only the audience, the seven affected TikTok tests passed again; typecheck and production build passed on the final source. No real social posts were sent. Deployed exactly one source file, WebComposer.tsx, after a targeted dry-run; checksum sync reports no differences. Backup: `/srv/posterract/backups/composer-before-tiktok-default-everyone-20260916.tar.gz`. Only web was rebuilt/recreated. Container is healthy and all readiness dependencies report OK. Public composer `compose-qD4Uqis0.js` was fetched and verified to contain the capability-checked Everyone default.

Logs: `/tmp/posterract-tiktok-default-tests.log`, `/tmp/posterract-tiktok-default-final-tests.log`, `/tmp/posterract-tiktok-default-typecheck.log`, `/tmp/posterract-tiktok-default-build.log`, `/tmp/posterract-tiktok-default-deploy.log`.
