**Posterract — web New post redesign plan**

**Superseded after design review.** The founder rejected the proposed mockups for changing Posterract's core design and oversizing/renaming the scheduling component. Use [the revised preservation plan](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-preservation-plan-v2.md>) instead. The original mockups are retained as rejected references, not implementation targets.

Prepared September 16, 2026. This is a design and implementation plan with generated concept mockups. It does not change or deploy the product. Scope: web only; desktop keeps its existing composer.

**1. Layout decision**

Replace the three tall columns with two independently sized columns: a combined post card on the left and a publishing column on the right. At desktop widths, allocate approximately 58% / 42%, with a 24px gap and a maximum content width of 1360px. Neither column stretches the other. Use the existing Posterract header and navigation dock, keeping enough clearance that neither overlays a control.

The left column contains the account selector and one post card. The right column begins with Trajectory, followed by a compact preview and the publish action. Account selection belongs immediately above the post card, not in the publishing column. This makes the workflow visible: choose destinations, compose, review timing, publish.

At 1440×900 with a short caption and one uploaded video, aim to show the account selector, complete post card, Trajectory, compact preview, and primary action without scrolling. This is a target to verify in the browser, not a fixed-height constraint. Long captions, validation messages, zoom, and translations must expand naturally.

**2. Compact account selection**

- Replace the stacked account cards with a roughly 64–80px toolbar. Use actual account photos in 44–48px circles, with a recognizable 16–18px platform badge overlapping the lower-right corner. Keep a minimum 44px interactive target.
- The first line reads “Publish to” and includes a small account-set selector. The avatar row below is compact, with a visible selected count. “+ Accounts” opens a searchable picker for additional connected accounts and a Connect account action.
- A mint ring plus a small check marks selection; muted images indicate unselected accounts. An amber attention mark indicates a selected account that needs reconnection or settings. Color alone never communicates state.
- Each avatar represents a concrete account ID. Clicking an unselected account selects it; clicking a selected account deselects it. The display photo alone is insufficient: hover and keyboard focus reveal the platform, account display name, and handle. Touch users can read the same identity in the account picker and preview.
- Keep all supported connected accounts available. When many accounts exist, show a bounded strip and a “+N” overflow picker rather than adding rows of full-size cards. On small screens, allow horizontal scrolling within the strip, never across the whole page.
- Preserve the current one-account-per-platform contract. Selecting a different Instagram account replaces the previous Instagram target, with clear immediate feedback. Do not imply that two accounts on the same platform can publish together: the current API rejects duplicate providers.
- Account sets select the exact saved account IDs. Manual changes switch the set label to “Custom.” Missing or expired accounts remain identifiable and block submission; the UI must never silently select another account.
- Use account initials when an avatar is missing or fails to load. Preserve the corner platform mark. Do not invent profile photos for real customers.

**3. One card for the whole post**

The post card has five connected areas, separated by fine dividers rather than nested panels:

1. A small “Post” header and a compact outlined “Platform settings” button with a gear icon and an issue count when needed.
2. The existing shared/per-platform caption tab concept: “Shared,” then only the selected platforms. A small marker identifies a custom caption. This remains one component with one visible textarea.
3. A caption area that begins around 160–200px tall on desktop. It grows for normal writing, with a practical maximum before internal scrolling. Avoid an oversized blank canvas. Show a clear Shared/Custom state and the relevant character limit, including hashtags.
4. An attached-media strip inside the same card. Empty state: a shallow approximately 96px drop target with Upload video and Choose from library. Loaded state: a small portrait thumbnail, filename, duration, aspect ratio, upload status, Replace, and Remove. The entire card can accept a dragged video while the drop indicator is active. Adding media never erases the caption.
5. A slim bottom row for shared hashtag chips and their input. Keep hashtags explicitly labeled as applying to all selected platforms. Avoid unsupported rich-text or decorative toolbars.

The larger playable video lives in the right-side preview. The attachment thumbnail identifies the file; it is not a second full-size player. Clicking the thumbnail can focus or expand the preview. The media workflow stays one video per post because that is what this composer currently supports; an empty multi-attachment gallery would imply functionality that does not exist.

**4. Caption behavior**

- Shared is the default tab. Editing it updates the effective caption for every platform that still inherits it.
- A platform tab shows its identity, effective caption, character count, and “Using shared caption” or “Custom caption.” A clear Customize action creates an override from the current Shared text. “Use shared caption” removes the override.
- Preserve the current blank-override rule: a blank platform override inherits Shared. Label this explicitly; do not silently introduce different empty-caption semantics as part of a layout redesign.
- Custom overrides survive changes to Shared. Changing tabs never copies text into another platform. Deselecting a platform removes it from the outgoing targets but retains its text during the current compose session in case it is reselected.
- Captions remain outside the settings dialog. The dialog never contains a second caption editor.
- Render hashtags exactly once in the outgoing caption and preview. Preserve template substitution and the existing copy-post behavior, which already treats stored captions as including the original hashtags.
- Shared counts should identify the tightest selected-platform limit and any affected platforms. A platform tab uses that platform's actual capability limit. Errors link to the relevant caption tab.

**5. Platform settings dialog**

The button in the post card opens a centered dialog, approximately 720–800px wide on desktop, with a viewport-bounded height. It uses Posterract's dark panels, mint active states, and restrained borders. The page remains visible behind a darkened backdrop.

The top contains “Platform settings,” a close control, and horizontal tabs for selected platforms only. Each tab includes its platform mark, label, and any attention indicator. Below it, show the selected account's avatar, name, and handle so the user knows exactly which account the settings affect. Account replacement remains in the account selector rather than creating another conflicting selector here.

For TikTok, preserve the existing controls and validation: direct publishing versus inbox delivery; freshly loaded account capabilities; required privacy selection; comments, Duet, and Stitch with account-disabled states; commercial disclosures and their dependencies; AI-generated content; refresh and retry states; and the appropriate declarations. Do not preselect privacy simply to make the mockup look complete. A populated mockup represents a choice already made by the user.

For Instagram, Facebook, and Threads, show their supported format and relevant capabilities. Display actual available per-post controls only. If a platform has no additional configurable options, state that clearly and show a compact format summary. Consistent tabs do not require invented privacy, music, or scheduling controls.

Settings apply immediately to the current post state; “Done” closes the dialog. Closing and reopening preserves those choices, even if incomplete. Opening a dialog or switching a tab must not reset TikTok settings. Changing the TikTok account must reset account-dependent choices and reload its capabilities, as required by the existing workflow.

Opening from an error selects the affected platform and focuses the failing field. Opening normally restores the last selected settings tab, or selects the current caption platform where appropriate. Use separate state for caption and settings tabs so browsing preferences cannot accidentally change what the user is editing.

Use dialog focus trapping, Escape to close, background scroll locking, focus restoration, and accessible tab keyboard navigation. Keep the header and Done button visible while the settings body scrolls. At narrow widths, use a near-full-screen dialog with the same controls and ordering.

**6. Right column, in this exact order**

| Order | Area | Contents |
| --- | --- | --- |
| 1 | Trajectory | Post now / Schedule, date and time when relevant, explicit timezone |
| 2 | Post preview | Selected account identity, platform switcher, playable video and effective caption |
| 3 | Readiness and action | Compact status, actionable blockers, required declaration, one primary action |

Trajectory is always the first right-column card. It is never below a list of accounts or TikTok controls. The scheduled state shows date, time, and timezone together. Preserve calendar-provided schedule defaults and validate again at submission, because a previously valid time can pass while the user is editing.

The preview uses a bounded media area, approximately 210–260px tall in the compact desktop state. Preserve the video's aspect ratio with contain sizing. A platform selector changes the account, caption, hashtag rendering, and format label; it does not change the selected destinations. Clicking a caption platform tab can sync the preview to that platform. Selecting Shared retains the current preview platform with a clear “Using shared caption” status.

The preview is a content preview, not a claim of pixel-perfect native feed rendering. Do not add fake likes, follower counts, or engagement. Retain existing safe-zone access as an optional preview control and provide an expanded player for closer inspection.

Readiness should collapse to one calm line when valid. When blocked, show concrete actions such as “Choose TikTok privacy,” “Reconnect Instagram,” or “Choose a future time.” These actions open the right dialog/tab/control. Show the same blockers used by the publish button; never display “all checks passed” while the button is disabled for an omitted requirement.

Keep the required TikTok declaration adjacent to the publish action where applicable. Preserve the distinction between publishing and inbox delivery. Labels remain Publish now, Schedule post, or Send to TikTok inbox as appropriate; scheduled inbox delivery must explicitly say that finishing the post happens in TikTok.

Avoid another full destination list. The avatars and preview already identify destinations; use a short destination count near the action. Preserve the existing multi-platform immediate-publish confirmation and idempotent submission behavior.

**7. Responsive behavior and visual system**

- Desktop, approximately 1180px and above: 58/42 columns, align-start, no equal-height stretches. Cap overall width so large monitors do not create a gigantic textarea. Only use sticky positioning where the entire publishing block fits below the header.
- Tablet, approximately 768–1179px: one column. Order: compact accounts, Trajectory, combined post card, collapsible preview, publish action. This keeps timing easy to find when there is no right column.
- Phone, below approximately 768px: 16px page gutters; horizontally scrollable avatars and caption tabs; caption above a compact attachment row; hashtags wrap. The settings dialog uses almost the full viewport. The publish control stays in the normal flow or in a measured sticky footer with explicit clearance above the existing dock—never an overlapping second dock.
- Validate at 320, 390, 768, 1280, and 1440px, plus a 1280×720 laptop, browser zoom, long filenames, long handles, and long captions. Breakpoints are driven by content fit.
- Preserve Posterract's near-black green background, dark green surfaces, mint #65ff9a selection/CTA, pale text #e9f6ef, and muted text #91ad9e. Use the existing brand typefaces and platform marks. Platform logo colors remain recognizable while interface accents remain mint.
- Use restrained corner brackets or geometric details sparingly, 12–16px panel radii, clear labels, and 16–24px internal spacing. No oversized title, purple UI, decorative statistics, repeated neon outlines, or anime art.
- Animate hover/focus and dialog transitions gently, respecting reduced motion. Selected avatars use ring plus check; warnings use icon plus text. Test keyboard, focus visibility, contrast, and screen-reader labels.

**8. Implementation map and preservation rules**

The repository currently routes directly to the shared Composer in apps/web/src/routes/_app/compose.tsx. The previously added WebComposer files remain in the tree but are not wired into that route. Start from this verified current state rather than assuming the earlier web split is still active.

When implementing, add an explicit web/desktop entry boundary. Keep the existing desktop Composer and its shared dependencies behaviorally unchanged. Build the new web experience in scoped files under apps/web/src/components/composer, reusing proven upload, artifact, account, capability, TikTok, and submission functions.

Suggested web-only pieces: WebAccountStrip, WebPostCard, WebCaptionTabs, WebMediaAttachment, WebPlatformSettingsDialog, WebTrajectory, WebPostPreview, and WebPublishActions. Names describe responsibilities; avoid splitting simple markup into needless abstractions.

Keep one canonical state owner for selected account IDs, selected platforms, artifact, Shared caption, overrides, hashtags, TikTok settings, and schedule. Dialog/preview state references that data; it never owns a second divergent draft. Extract one derived readiness calculation consumed by badges, error links, summary, and submission guard.

Do not change billing, landing pages, desktop UI, account authorization, or the publishing API contract. Use existing avatarUrl and creator identity data; the avatar design does not need new credentials or a new profile service. Recheck working-tree changes before editing because this repository contains other ongoing work.

**9. Build order and acceptance criteria**

1. Establish the web-only boundary and capture desktop regression behavior. Implement the two-column skeleton, top Trajectory, and compact accounts first.
2. Combine captions/media/hashtags in one card while preserving current state and request payloads. Verify exact account IDs, caption inheritance, account-set replacement, and media replacement.
3. Move actual platform settings into the dialog. Verify close/reopen persistence, account changes, asynchronous creator responses, focus handling, loading, and errors.
4. Add the compact preview from the same effective caption/media/account values used for submission. Connect actionable readiness errors to the correct controls.
5. Check visual density and behavior in the browser at all target sizes. With the dialog closed, no platform configuration block should occupy permanent page space. No account card should become an entire row of the desktop publishing column. No caption/media card may stretch because another column is tall.
6. Run typecheck/build and focused browser regressions: Shared/custom/reset; hashtags once; zero/one/many destinations; one-account-per-platform replacement; disconnected/missing accounts; broken avatars; upload failure/replace; TikTok privacy/disclosure/capability restrictions; dialog keyboard behavior; invalid schedule; request payload identity; duplicate-click prevention; failure recovery; desktop unchanged.
7. On implementation approval, deploy only the affected web files and web service through the documented VPS process. Verify production health and served assets, and inspect the authenticated web composer if a session is available. Use local/mock publishing during tests; do not post to customers' social accounts to test the UI.

**10. Mockup deliverables**

Generate two concept images after this plan: the normal desktop page with compact avatars, combined post card, top-right Trajectory and preview; then the same design with Platform settings open on the TikTok tab. Use the built-in imagegen tool. These are review visuals, not deployed UI, and sample profile/media/caption data is illustrative. The implementation plan remains authoritative where generated small text or exact icon geometry differs.

Completed with the built-in imagegen tool, using the main-page concept as the edit target for the dialog state:

- [Main page mockup](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-mockups/main-page.png>)
- [Platform settings mockup](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-mockups/platform-settings.png>)
- [Exact main-page generation prompt](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-main-mockup-prompt.txt>)
- [Exact settings-dialog generation prompt](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-settings-mockup-prompt.txt>)

Visual review: both concepts communicate the avatar/platform badge treatment, compact media attachment, single tabbed caption area, top-right timing controls, and dialog-only platform preferences. Generated sample identity, character counters, logo geometry, and shell embellishments are illustrative; implementation reuses real account data, computed limits, and the existing application shell. No source changes or deployment were performed for this planning request.
