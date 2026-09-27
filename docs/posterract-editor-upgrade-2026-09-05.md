# Posterract editor upgrade — local macOS preview

September 5, 2026. This implements the first editor-focused release from the product review. It is a local Apple Silicon macOS preview; the shared renderer changes also apply to future Windows/Linux builds, which have not been packaged or tested in this pass. No commit, push, or production deployment was made.

## What changed

- **Three workspaces:** Storyboard, Edit, and Motion preserve their panel visibility and timeline height. Edit/Motion open with a usable timeline. The mixer is optional, and panels no longer automatically fade while the user works.
- **A clearer editor shell:** persistent project/save controls, scene switching, agent access, panel controls, and Export. Assets sit in a collapsible drawer; Design, Motion, and History have separate inspector tabs. Typography, spacing, contrast, selection summaries, and important control names have been improved.
- **Canvas framing:** Fit measures the space left by the open panels and timeline. Storyboard fits all scenes; Edit/Motion fit the active scene. Intentional manual framing persists until Fit is requested. A transform synchronization fix prevents repeated fits from shrinking the preview incorrectly.
- **A more useful timeline:** Clips, Animation, and Everything are visible choices. Presets and procedural properties inside sequences are discoverable. Animation, effect, fill, stroke, shadow, and component rows have selectable spans instead of misleading media trim controls. Zoom buttons now enlarge/shrink clips in the expected direction; Fit measures the active scene and actual viewport.
- **Source-backed motion editing:** selecting a preset row opens its inspector. Entrance/Exit creation and timing changes use the existing project-source writer and undo system. Animation spans account for local time, playback rate, and nested stagger. Duration/delay controls allow frame-level increments.
- **Selection actions:** Timeline reveals the selected object; Code uses the existing source-location bridge. The temporary Ask agent copy/paste UI was removed at the founder's request. Users continue working directly in their actual agent app; the header Agent control remains the client connection/launcher.
- **Calendar popups:** calendar entries remain compact, with time/title and a status dot. Clicking a post opens its media, caption, account statuses, destination errors, available live links, and applicable reschedule/cancel/retry actions. Closing keeps the calendar position. No automatic saving of unfinished social-post drafts was added.
- **Calendar correctness:** local calendar-day arithmetic handles daylight-saving transitions, the first week of a month opens the correct month, and rescheduling reads the actual submitted date/time. The visible timezone is included; nonexistent local times are rejected.

## The code/timeline contract

TSX remains the composition source of truth. Native authored elements and supported animation/effect/property children are shown under their owners in the timeline. Changing those properties uses the existing source writer; undo restores the authored values. The timeline represents composition structure over time, rather than creating a new playback track for every mouse movement or history event.

Arbitrary procedural JavaScript is not automatically converted into draggable keyframes. Procedural rows remain visible, and the existing source/bake workflow remains relevant. Preset spans can be selected and their timing edited in the inspector; direct dragging/trimming of those spans is a later task. Component instance identity, shared-instance edit scopes, and a custom HyperFrames-compatible engine are also follow-up work.

## Validation

- Editor, web, and desktop TypeScript checks.
- Desktop build, with both final renderer bundles rebuilt for desktop configuration.
- Seven focused workspace tests: remaining-space canvas fit, invalid bounds, sequence preset visibility, keyframe/live/paint detail modes, stagger/local clocks, timeline zoom anchoring and active-scene fit, and spring/fall calendar transitions.
- Ten existing source-edit tests and 22 runtime tests passed (39 tests in total).
- Native macOS interaction checks used a separate **Editor Upgrade Preview** project: workspace switching, stable repeated Fit, animation row selection, editing duration to 1.2 seconds, confirming that value in TSX, undoing back to 0.8 seconds, adding/removing an Exit animation, and copying a request with selection context. Project validation passed after source edits.
- The packaged Apple Silicon application opened successfully with the existing desktop profile. The preview project played and paused correctly; the Motion workspace displayed its entrance/exit spans and selected animation controls. Source-availability and owner-hierarchy refresh fixes keep the Code action and selected-part inspector current after reopening a project.
- Calendar checks used the local demo engine, without publishing or changing real posts: popup opening, rescheduling a sample post to another day/time, confirming its new calendar cell, cancellation, and refreshed per-account statuses.
- `git diff --check` passed.

## Remaining release work

The wider backlog is still relevant. In particular: direct manipulation of motion spans, component instance identity/controls, curve/path editing, transactional agent batches, automatic task/session integration, render provenance, and external Lottie asset/font handling are not completed by this UI release. The existing external-font CSP issue was observed when browsing typography; this pass does not claim to resolve it.

This preview needs broader project/device regression testing and the normal signed release process before distribution. The local macOS package is for review on this machine, not a notarized installer. Existing bundle-size warnings remain.

Latest local application: `apps/desktop/out/ui-review/Posterract-darwin-arm64/Posterract.app`. This is packaged separately so the running preview and the installed copy in `/Applications` are not overwritten.

## Follow-up UI corrections

This section records the preceding preview. The latest requested changes below supersede the Ask agent popup work.

The founder's screenshot and interaction feedback led to a second local preview update:

- Export now uses one aligned, rounded dark-green control with a mint icon accent, an inset divider, and consistent hover/focus states. Quick export and the options menu retain their existing actions.
- Both the header Agent popup and the inspector's Ask agent popup render in a portal above the editor panels. Their width/height stay within the window, long content scrolls, and their backgrounds remain opaque in Glass mode.
- The duplicate Generate launcher was replaced by one persistent rail entry. It owns the existing Image/Video/Voice panel and remains usable when the asset drawer is collapsed; contextual generation requests still use the same launcher.
- Editor keyboard handling respects floating controls. Tab navigates the agent popup, and Escape dismisses it without also clearing the canvas selection.

Validation: editor TypeScript check, desktop renderer build, local arm64 packaging, and `git diff --check` passed. Native checks verified the new Export appearance/menu, both agent popups above the inspector, Tab moving from Codex to Claude Code, Escape preserving the selected scene and returning focus, and the single Generate entry opening its panel with the drawer collapsed. No agent was launched, media generated, or post published during these checks. No VPS deployment was performed.

## Latest requested changes

- Removed the entire inspector Ask agent form, clipboard handoff, and associated UI state.
- Moved the exports library beside Projects on the project-picker screen. Removed the project's Exports rail button and drawer state. The export-menu library shortcut navigates to that separate library screen.
- Corrected the film icon's missing SVG viewBox and normalized rail icon sizing/centering. Assets and Generate now use consistent centered outline symbols.
- Labeled the scene selector **Active video**, with a tooltip explaining that it selects the timeline and export target. A project with one video shows its name without a dropdown. “Launch story” and “Landscape cut” are names of the two sample videos in the preview fixture.
- Ran one TypeScript/build check for this batch and packaged to a separate output directory. The user's running app was not closed, reopened, reloaded, or replaced. These latest changes have not been visually checked in the running app.

The three workspaces share one composition: Storyboard fits all scenes, Edit provides a balanced canvas/assets/timeline layout, and Motion gives the timeline and animation inspector more room. Workspace panel choices are remembered independently.
