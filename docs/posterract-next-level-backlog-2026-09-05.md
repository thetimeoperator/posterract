# Posterract next-level backlog

Date: September 5, 2026. The first editor-focused macOS preview is now implemented; see the [implementation and validation record](./posterract-editor-upgrade-2026-09-05.md). Checkboxes below remain release acceptance gates, including the broader fixture and device checks described in each row. No GitHub issues, commits, or deployments were created.

The preview delivers work across A02–A04, B01–B06, B11, and F02/F05, with initial improvements toward B07–B09, C04/C07, D02, and E02. It does not mark those broader areas complete merely because the first UI is available.

Read with the [research and architecture review](</Users/sinapahlevan/CODING PROJECTS/vidtryx/docs/posterract-product-review-2026-09-05.md>). This backlog extends existing functionality; it is not a list of features assumed to be missing.

## How to use this list

**P1:** high-value prerequisite, correctness fix, or core usability work. **P2:** next feature/polish release. **P3:** validate demand or run a bounded experiment first.

**S:** approximately 0.5–2 engineering days. **M:** approximately 3–5 days. **L:** approximately 1–2 engineering weeks. **XL:** requires a scoped design/spike before a credible estimate. These are rough task-size estimates, excluding release coordination and broad device QA; they are not a delivery commitment. Dependencies indicate ordering, not a requirement to finish an entire category first.

## A. Baseline and concrete corrections

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | A01 | P1 / M | Create representative project fixtures and record baseline behavior | Fixtures cover footage, captions, native motion, repeated components, external Lottie fonts/images, multiple source files, and aspect variants; source and expected frames are versioned | — |
| [ ] | A02 | P1 / S | Fix preset/procedural animation visibility inside sequences | Preset-only and expression-driven children are discoverable in Animation view; Clips and Everything retain their documented behavior | A01 |
| [ ] | A03 | P1 / M | Replace inconsistent inspector type gating with element capabilities | Vector and Lottie selections receive applicable time/transform/motion controls; unsupported actions are explained; fixture matrix covers every supported type | A01 |
| [ ] | A04 | P1 / M | Fix week/month calendar date arithmetic | Navigation/cells stay on calendar dates across DST; spring/fall and non-DST zone fixtures pass | — |
| [ ] | A05 | P1 / L | Freeze render input/provenance before capture | Source files, relevant assets/fonts, SDK version, format, and scene are captured in a manifest; output references that manifest even if editing continues | A01 |
| [ ] | A06 | P1 / M | Expose save/compile/mount readiness with revisions | Agent and UI distinguish queued, saving, compiling, ready, stale-preview, and error; ready references the mounted revision | A01 |
| [ ] | A07 | P2 / S | Derive preflight from exact account selections | Changes to account set, automatic mode, and set membership invalidate checks immediately; checks and payload share resolved destinations | — |
| [ ] | A08 | P2 / M | Fix source reveal for multi-file projects | A child authored in an imported TSX component opens the correct file/line; missing IDs report a clear error | A01 |
| [ ] | A09 | P2 / S | Show exports-library errors distinctly from empty state | Failed list/record operations expose retry; a successful render is retained even if indexing fails | — |

## B. Editor UI and canvas

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | B01 | P1 / M | Prototype Storyboard, Edit, and Motion layouts | Same project/selection survives switching; creators can explain each workspace and complete a representative task in it | A01 |
| [ ] | B02 | P1 / M | Implement adaptive preview fit and stable manual zoom | Opening/resizing panels never covers the active scene in fit mode; intentional manual framing persists until Fit is requested | B01 |
| [ ] | B03 | P1 / S | Make Export persistent and selection-independent | User can export the active scene from the top bar; multiple scenes and no active scene have clear selection behavior | B01 |
| [ ] | B04 | P1 / M | Improve operational typography, spacing, and contrast | Essential text is readable at agreed laptop sizes/scaling; selected/disabled/focus states are distinct; no reliance on glow alone | B01 |
| [ ] | B05 | P1 / M | Name controls and complete keyboard/focus affordances | Important controls have accessible names and visible focus; no keyboard traps; OS shortcut labels are correct | B01 |
| [ ] | B06 | P1 / M | Open the timeline by default in Edit/Motion; show detail mode | New-user Edit opens usable lanes; Clips/Animation/Everything is visible; saved user preferences remain respected | B01, A02 |
| [ ] | B07 | P2 / M | Add a focused, searchable inspector structure | Selected object shows relevant controls first; fixed/keyframed/expression/component-bound values are distinguishable | A03 |
| [ ] | B08 | P2 / M | Move full history to a useful drawer | Named changes, author, affected objects, before/after thumbnail, and restore are available; empty-selection inspector remains useful | A06 |
| [ ] | B09 | P2 / M | Improve bidirectional reveal and nested selection | Canvas selection can reveal its timeline row; row reveals its object; overlap picker and breadcrumb handle nested content | A08 |
| [ ] | B10 | P2 / M | Unify React/Solid design tokens | Spacing, color, text, focus, control sizes, and status semantics match across editor and publishing; no framework rewrite | B04 |
| [ ] | B11 | P2 / S | Make mixer and focus dimming deliberate | Mixer opens when needed; automatic dimming can be disabled and is not required to enjoy the floating design | B01 |
| [ ] | B12 | P2 / M | Improve asset and component browsing | Search, useful thumbnails, replace-media action, missing-asset repair, and insert-at-playhead work with keyboard and drag/drop | B05 |

## C. Timeline and component structure

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | C01 | P1 / L | Introduce stable component-instance identity | Two calls to the same component remain separate through reorder/recompile; keyed repeated items retain identity | A01 |
| [ ] | C02 | P1 / M | Define the derived document/editability index | Each supported object reports source, owner instance, bounds/timing, property origins, and supported edits; TSX remains canonical | C01, A03 |
| [ ] | C03 | P2 / M | Add collapsed motion summaries and timeline filters | Animated clips remain visibly animated while collapsed; selected/animated filters preserve selection and reveal behavior | A02, B06 |
| [ ] | C04 | P2 / L | Make animation spans directly editable | Entrance/hold/exit segments can be moved/trimmed/retimed with clear local-time semantics and undo | C02 |
| [ ] | C05 | P2 / M | Distinguish content history from timeline structure | Editing a transform creates a named recoverable change, not a new playback track; static effects stay under their owner | B08, C02 |
| [ ] | C06 | P2 / M | Provide component instance/all/detach scopes | User can edit one instance, edit shared controls, or detach with a clear preview of impact | C01, C02 |
| [ ] | C07 | P2 / M | Audit timeline viewport and FPS round trips | Zoom/time position survives scene switching and FPS changes; selectively adopt useful upstream semantics | A01 |

## D. Agent collaboration

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | D01 | P1 / M | Add explicit connection/session status | Available client, configured tools, verified project connection, running task, and disconnection are distinct | A06 |
| [ ] | D02 | P1 / M | Add selected-context request handoff | Request includes selection, scene, time range, revision, and intent; unsupported clients get an honest Copy request flow | D01, C02 |
| [ ] | D03 | P1 / L | Add transactional semantic edit batches and receipts | Batch has operation ID, expected revision, scope, save/mount completion, diagnostics, affected objects, and one undo transaction | A06, C02 |
| [ ] | D04 | P1 / M | Handle stale writes, retries, and project switches | Repeated operation ID is deduplicated; stale revision is rejected; switching projects cannot redirect an in-flight edit | D03 |
| [ ] | D05 | P2 / L | Add agent change review with before/after | User can inspect changed frame/range, jump to affected objects, accept broad changes, and revert without losing unrelated edits | D03, A05 |
| [ ] | D06 | P2 / M | Add canvas annotations as agent targets | Region/element/time annotation is passed with the request and can be resolved; it never becomes exported scene content accidentally | D02 |
| [ ] | D07 | P2 / M | Make inspection non-disruptive | Background geometry/capture does not steal active selection, playhead, or viewport; results state which revision/frame they measured | A05, A06 |
| [ ] | D08 | P2 / M | Add incremental agent context and contextual help | Agent requests changes since revision or a selected subtree; component/skill controls are documented from current schemas | C02, D03 |
| [ ] | D09 | P1 / M | Create an end-to-end agent editing evaluation set | Human→agent→human, undo/reopen, stale write, procedural bake, and exact export cases run without touching real publishing accounts | A01, D03 |

## E. Motion authoring, Lottie, and skills

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | E01 | P1 / M | Define component manifests and editable controls | Supported text/color/number/enum/asset/timing controls have defaults, constraints, identities, and versions | C02 |
| [ ] | E02 | P2 / L | Build the Entrance/During/Exit animation inspector | Selected-element previews, amount/direction/easing/stagger controls, reset, and timeline spans all write back correctly | C04, E01 |
| [ ] | E03 | P2 / L | Improve curve editing, path overlays, and retiming | User can edit easing, identify key poses, move supported path points, and retime multiple keys without breaking source | E02 |
| [ ] | E04 | P1 / M | Fix Lottie managed fonts/images and typed slots | Representative imported assets render after reopening/export; override starts with the file's actual typed value | A01 |
| [ ] | E05 | P2 / M | Add Lottie metadata and interoperability controls | Labels/ranges/order/vector slots/RGBA behavior are specified; unsupported slot types are explained rather than silently ignored | E04 |
| [ ] | E06 | P2 / M | Complete skill starter insertion | Attach guidance and Insert starter are separate; starter preview/insertion creates named native elements and one undoable change | E01, D03 |
| [ ] | E07 | P2 / L | Ship the first curated component pack | Headline, caption emphasis, product entrance, diagram, logo, lower third, and CTA examples expose useful controls and pass fixtures | E01, E02 |
| [ ] | E08 | P2 / L | Add transcript-focused editing | Word/cue selection maps to time; caption corrections preserve timing; silence-removal preview shows the cut before applying | B01, D03 |
| [ ] | E09 | P2 / M | Improve audio roles and envelopes | Assign voice/music roles, inspect/edit ducking, show envelope on timeline, and verify sound remains aligned after cuts | A01, C04 |
| [ ] | E10 | P2 / L | Add bounded responsive component variants | Chosen components produce 9:16/1:1/16:9 layouts with explicit overrides; reflow is editable and does not silently alter master content | E01, C06 |
| [ ] | E11 | P3 / L | Prototype gesture recording | Recorded motion becomes ordinary keyframes; simplification, retiming, undo, and random seeks behave predictably | E03 |
| [ ] | E12 | P3 / XL | Prototype HTML/HyperFrames compatibility | Bounded fixture set passes clock/media ownership, identity, source-edit scope, capture, random-seek, and memory criteria | A05, C02, E01 |

## F. Publishing, variants, and analytics

Founder preference: omit automatic saving of unfinished social-post drafts. Keep calendar entries minimal; clicking a scheduled or published post opens its details popup. F02 now describes that popup, replacing the former draft-saving proposal.

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | F01 | P1 / S | Unify capability availability and clear publication wording | UI/docs/agent capabilities agree on available destinations; direct publishing and TikTok draft delivery are explicitly different | — |
| [ ] | F02 | P1 / M | Open post details in a popup from the calendar | Clicking scheduled or published posts shows media, caption, exact accounts, time/timezone, and per-destination status; scheduled items offer applicable edit/reschedule/cancel actions; published items link to the live post when available; closing preserves calendar position and returns focus | F01 |
| [ ] | F03 | P1 / M | Show exact destination accounts with actionable readiness | User sees account/brand identities; invalid destinations block submission; UI/server validation agree | A07, F01 |
| [ ] | F04 | P2 / M | Add explicit timezone and ambiguous-time handling | Chosen zone is visible and persisted with scheduling intent; ambiguous/nonexistent local times receive a clear resolution | A04 |
| [ ] | F05 | P2 / M | Compact the calendar and keep entries minimal | Working grid has more usable height; entries use a short label/thumbnail and time; full captions, accounts, statuses, and actions appear in the post-details popup; dense and narrow displays remain navigable | B10, F02 |
| [ ] | F06 | P1 / M | Bind scheduled posts to immutable renders | Composer/post records show source scene and exact render manifest; source changes never silently replace a scheduled asset | A05, F03 |
| [ ] | F07 | P2 / L | Add variant/campaign relationships | Formats and hook variants share a master relationship while each remains editable; schedule selects a specific render | E10, F06 |
| [ ] | F08 | P1 / L | Validate retry/reconciliation and partial outcomes | Provider accepts-then-timeout, credential expiry, retry, cancellation, and mixed destination outcomes preserve correct IDs and avoid duplicate work | A01, F01 |
| [ ] | F09 | P2 / M | Link publication results back to creative variants | User can open source from a post and compare performance by variant; analytics distinguishes missing data and avoids causal claims | F06, F07 |

## G. Release and product validation

| Done | ID | Priority / size | Task | Acceptance criterion | Depends on |
| --- | --- | --- | --- | --- | --- |
| [ ] | G01 | P1 / L | Run shared fixtures on the supported OS/device matrix | Installation, actual agent handshake, media import, font rendering, seek, export, and recovery pass on selected macOS/Windows/Linux configurations | A01 |
| [ ] | G02 | P1 / M | Add random-seek and preview/export comparison checks | Same scene/frame stays visually consistent within documented tolerances; failures include reproducible manifests | A05 |
| [ ] | G03 | P2 / M | Establish performance budgets and profiles | Seek/input latency, memory, dropped preview frames, and export duration are measured on named devices/fixtures; budgets reflect actual baselines | A01, G01 |
| [ ] | G04 | P1 / M | Run creator usability sessions for the proposed UI | Approximately 5–8 representative creators attempt the same tasks; blockers and successful interactions are documented | B01 |
| [ ] | G05 | P1 / M | Verify migrations/recovery against existing projects | Changes to manifests, instance IDs, or timing preserve existing projects and support rollback/backup | C01, A05 |

## The first release I would actually scope

Do not attempt to complete every row in one release. Start with A01–A06, B01–B06, B11, F01, and the relevant G01/G04 checks. Add A07 and A09 if capacity permits; both are bounded fixes. Validate render provenance and agent readiness before marketing the result as a reliable collaborative editing workflow.

The first release's visible changes should be easy to describe: **a bigger usable preview, a timeline that is visible and understandable, consistent inspector controls, persistent Export, accurate scheduling dates, and reliable save/render state.**

Next, deliver C01/C02 and D01–D04/D09. These enable a strong agent experience and reliable component authoring. The broader motion library, advanced curves, and campaign workflow follow that foundation.

## Changes I would deliberately defer

- A wholesale editor/runtime replacement.
- A giant effects marketplace before a small pack proves useful.
- Native editing of every arbitrary DOM/3D/Lottie internal object.
- Building a new codec or vector renderer.
- Multi-user simultaneous editing before project revisions and operation transactions are reliable.
- A custom hosted chat product merely to avoid using the user's existing agent.
- Automatic “performance optimization” of creative content without usable variant provenance and comparable analytics.
- A visual redesign based mainly on more blur, glow, animated chrome, or smaller controls.

## Existing implementation owners

These are code boundaries for planning, not assignments to individuals:

| Work | Main code area |
| --- | --- |
| UI, canvas, inspector, timeline | [editor source](</Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/editor-sandbox/src>) |
| Component/source identity | [compiler](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/video-compiler/src>), [composition](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/posterract-composition/src>), [reconciler](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/posterract-video-reconciler/src>) |
| Timing/render/animation | [runtime](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/posterract-video-runtime/src>), [encoder](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/posterract-video-encoder/src>) |
| Agent protocol and local project host | [CLI](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/posterract-cli/src>), [desktop](</Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/desktop/src>) |
| Composer/calendar and shared capability model | [web](</Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/web/src>), [contract](</Users/sinapahlevan/CODING PROJECTS/vidtryx/packages/contract/src>) |
| Scheduling and publishing | [API](</Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/api/src>), [orchestrator](</Users/sinapahlevan/CODING PROJECTS/vidtryx/apps/orchestrator/src>) |

Production remains the existing VPS Docker Compose stack. Any future release should follow the repository's targeted verification/deployment rules and rebuild only affected services. This review does not propose changing that hosting model.
