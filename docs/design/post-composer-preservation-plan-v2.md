**Posterract web composer — revised preservation plan**

This supersedes the September 16 first proposal and its rejected mockups. The founder's correction is to retain the core Posterract design and the current compact scheduling component. This remains a web-only planning exercise; no application changes or deployment are authorized by this document itself.

**What stays exactly recognizable**

- Existing application header, wordmark, navigation dock, background, typography and type scale.
- Existing glass Panel surfaces with thin borders and corner brackets. Existing Panel headings are 15px; do not replace them with oversized conversational titles.
- Existing labels: THE MESSAGE / Caption, Base and platform caption tabs, TRAJECTORY / When, PRE-FLIGHT / Checks, Artifact, Hashtags. Reorganizing does not require renaming them.
- Existing Segmented control: Post now / Schedule, 32px-tall segment buttons, current border and mint selected treatment. The schedule panel does not grow to fill the column.
- Existing buttons, fields, focused states, platform logos and mint accents. No new search header, new user identity, stock portraits, bright solid primary-button treatment, or replacement logo/dock.

**Only the requested structural changes**

1. Move the existing Trajectory / When panel to the first position in the right column. Reuse its markup and sizing. In Post now mode, only the two existing segments are shown. Schedule expands the existing single Launch time field and timezone hint. Do not add a sentence-length heading, separate date/time/timezone cards, or permanent calendar.
2. Replace the tall Accounts list with a compact strip of the actual connected-account avatars and overlapping platform badges. Put it near the caption tabs so destinations and their text versions are adjacent. Use 40–44px avatars, a mint selection ring plus check, tooltip/keyboard account identity, and a small overflow/account-set control. Keep exact account IDs and one selected account per platform.
3. Put one small existing-style Settings button in the caption panel's header. Open platform preferences in the existing modal visual language, with tabs for selected platforms. Preserve the real TikTok controls and behavior. Other tabs expose actual supported options. Keep captions out of this modal.
4. Combine Artifact and Caption in one content-sized bracketed panel. Retain THE MESSAGE / Caption as the heading and the existing tabbed caption component. Inside the panel, use a modest 120–150px-wide media area beside the caption on desktop. Portrait media is approximately 215–267px tall, with compact metadata, Replace and UI zones controls. Keep Base/per-platform tabs, one textarea and Hashtags together in the larger adjacent area. On mobile, stack them in the same panel. An expanded player may open on demand; the page does not need a second permanent Post preview card.
5. Keep Pre-flight / Checks and the existing publish action below Trajectory in the right column. Show the exact same blockers used by the submit guard. Existing TikTok declarations stay adjacent to submission. Moving settings into a modal must not hide unfulfilled requirements.

**Density rules**

Use the existing right-column width and spacing as the starting point; do not impose the rejected 58/42 ratio. Use align-items:start and natural panel height. Combining two areas should remove duplicated panel framing and unused height, not produce a bigger new card. The media/Caption area must not stretch to match a taller right column.

At 1280–1440 desktop widths the page should read as the same Posterract interface: familiar modest header, Back to calendar, one compact combined panel, the narrow existing scheduling/checks column, and the original navigation dock. Leave normal page background beneath the content rather than stretching panels to fill it. Long text and real errors may grow naturally.

No desktop typography or navigation changes. No large new page title. No additional permanent preview, readiness card style, feature toolbar, or renamed workflow language. Preserve the existing responsive type sizes; reorganize flow at the existing practical breakpoints and ensure dock clearance.

**Behavior and implementation safeguards**

The current route uses the shared Composer. Implement a separate web entry before changing markup so desktop retains its existing component. Share proven engine/publishing logic without modifying desktop presentation. Keep state above the settings modal so close/reopen preserves choices. Switching accounts reloads account-specific TikTok capabilities and resets only the dependent choices. Switching modal tabs does not change the caption tab.

Preserve Base inheritance, custom overrides, blank-override fallback, hashtags once, account-set selection, precise account targeting, upload/library/replace behavior, calendar schedule defaults, and idempotent submission. Required settings must remain visible as actionable errors in Pre-flight even when the modal is closed. Do not fake settings for platforms without configurable options.

Verification should compare original and revised screenshots for typography, panel treatment, labels, control heights, and shell identity, then check viewport fit, keyboard/focus behavior, accounts, captions, modal persistence, TikTok validation, schedules, payloads, and the unchanged desktop route. Original functional test coverage remains relevant; the rejected mockups do not.

**Revised mockup direction**

Use the actual current composer screenshot as the visual reference, not the rejected generated images. Preserve its brand and component styling; change placement and grouping only. Use the actual Posterract avatar asset for illustrative account images. Show the exact compact Trajectory / When control in Post now mode. The generated result remains a concept; existing components are authoritative for precise typography and geometry.

Generated using built-in imagegen: [revised concept image](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-mockups/main-page-preserved-v2.png>). [Exact generation and correction prompts](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/design/post-composer-preserved-mockup-prompt.txt>).

Review note: the image is a grouping/layout concept, not a replacement design system. Reuse actual component styles and scale during implementation. Generated sample counters, account limits and footer copy do not override live data or required TikTok declarations. The current application header and dock remain authoritative, including details simplified by generation. No product code was changed.
