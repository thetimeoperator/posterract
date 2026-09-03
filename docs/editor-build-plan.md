# Posterract — Editor Completion Build Plan (September 2026)

This is a self-contained brief for a coding agent (Opus 5). It contains everything needed to
build the plan without any prior conversation: the product briefing, the architecture with
verified file anchors, the non-negotiable principles, and eleven phases with design specs,
implementation steps, acceptance criteria, and verification procedures.

Read sections 0–2 completely before touching code. Every phase in section 3 is written to be
executed independently, in order.

---

## 0. Operating rules (read first)

1. **Do not `git commit` or `git push` unless the founder explicitly says so.** Work in the
   working tree. The founder commits.
2. **Never test, call, or probe the founder's provider API keys.** Keys exist in
   `apps/api/.env` and in project folders as `api-keys.json`. Do not send requests with them.
   Verify provider contracts from public documentation only.
3. **Never deploy to the VPS unless told.** Production is Docker Compose on the VPS
   (`AGENTS.md` at repo root has the procedure). The editor is a desktop app; most of this plan
   never touches the VPS.
4. **Never introduce a hosted AI, credits, or a middleman.** AI is bring-your-own-keys, run
   locally in the desktop main process (see §1.7). The founder rejected hosted credits and
   ElevenLabs; do not reintroduce either.
5. **Exports are local.** A render lands on the user's machine. Upload happens only on an
   explicit Schedule / Post-now action. Preserve this in every change.
6. **The document is the TSX source.** Every edit must round-trip to source. Never invent a
   second persistence path.
7. **Verify with the real commands** (§1.9) after every phase, and rebuild + relaunch the
   desktop app (§1.10) so the founder can see the result. Report honestly: what passed, what
   didn't, what was skipped.
8. Use subagents only if the founder allows it; if used, they must be Opus-class.

---

## 1. Product & architecture briefing

### 1.1 What Posterract is

An agent-native desktop video editor plus a social media scheduler. The editor runs locally
(Electron) on the user's project folders; the scheduler (web + API + Temporal workers) runs on
a VPS and publishes to Instagram, TikTok, YouTube, Threads, and Facebook. A user's coding
agent (Claude Code, Codex, Cursor, …) connects to the open project through a local MCP server
and can read/edit the canvas. The editor is a source-derived fork of Diffusion Studio's
editor; the runtime core is shared with upstream, so upstream's public docs
(`github.com/diffusionstudio/editor/reference/jsx/*.md`) describe our composition contract
accurately unless noted here.

Brand rules for any UI copy: black / neon-green / white; never the word "tesseract"; the name
POSTERRACT stays visible.

### 1.2 Monorepo layout

```
apps/
  desktop/          Electron main process, packaging, CLI staging (src/main.ts, src/projects.ts, …)
  editor-sandbox/   THE EDITOR renderer (SolidJS) — not a sandbox despite the name
  web/              Scheduler web app (TanStack Router); also bundled into the desktop shell
  api/              Fastify API (PostgreSQL) — scheduler backend on the VPS
  orchestrator/     Temporal workers that publish to platforms
packages/
  posterract-composition/     The JSX contract: element types, props, hooks (types.ts is the authority)
  posterract-video-reconciler/ Solid universal renderer → koota ECS traits (document.ts, elements.ts)
  posterract-video-runtime/   ECS systems: motion, render (Canvas2D), playback, assets, queries, traits
  posterract-video-encoder/   Offline frame-stepped encoder (WebCodecs + mediabunny), captures
  posterract-video-assets/    Asset library, probing, manifests
  video-compiler/             Babel (solid universal) + esbuild compile of project TSX; ts-morph writer
  posterract-cli/             `posterract` CLI + MCP server (`mcp serve`), mailbox client
  contract/                   Shared contracts (local-agent state, platform capabilities)
  hyperkit/                   Design system (web)
posterract-skill/   The skill shipped to users' agents (SKILL.md + references)
deploy/posterract/  Dockerfile, compose, Postgres migrations (init/*.sql)
scripts/probe-bridge.mjs   Regression harness for the agent bridge (`pnpm probe:bridge`)
```

### 1.3 The document model (most important concept)

- A project is a folder. The entry file (`src/index.tsx` for scaffolded projects, `index.tsx`
  at root for migrated ones — resolution in `apps/desktop/src/projects.ts` `entryFor()` ~line
  396 using `package.json` `main`, then `ENTRY_FILES` ~line 72) default-exports a Solid
  component rendering `<stage>` → `<scene>` → elements.
- Compile: `packages/video-compiler/src/compiler.ts:40-52` (Babel `babel-preset-solid` in
  `universal` mode with `moduleName: "@posterract/composition"`, custom plugins stamp stable
  source ids onto every element).
- Mount: the reconciler maps each element to an ECS entity with traits. **Only composition
  elements produce entities; user-defined components compile away** (this matters for Phase 2).
- Edits from the UI go through ONE funnel: `apps/editor-sandbox/src/engine/editor.ts`
  (`DocumentEditor`: `PropEdit` ~:40, `TextEdit` ~:60, `InsertEdit` ~:77, `MoveEdit` ~:94,
  `RemoveEdit` ~:130) → `apps/editor-sandbox/src/projects/edits.ts` (`createEditWriter`,
  120 ms debounce ~:20/:157, failures reported via toast ~:283-286) → desktop
  `PROJECTS_WRITE` → `apps/desktop/src/projects.ts` `writeProject()` ~:607-641 →
  `packages/video-compiler/src/writer.ts` `applyEdits()` ~:1258 (ts-morph AST surgery,
  addressed by stable source id). Elements produced by `<For>`/`.map` are **unrolled** into
  literal copies on first edit (`SourceUnroll`, writer.ts ~:120-125).
- Undo: `apps/editor-sandbox/src/engine/history.ts` (`EditHistory` ~:129; replays inverse
  edits through the same funnel; 600 ms coalescing; cleared on remount — `pages/editor.tsx`
  ~:168 `getEditHistory(world).reset()`).
- Editor lifecycle: `apps/editor-sandbox/src/pages/editor.tsx` — `applyBundle()` mounts
  compiled code, creates the writer (~:148), auto-activates a first scene; `loadProject()`
  races a cached bundle (IndexedDB) against the compile; a file watcher reloads on external
  change (~:231-245); the cover is captured on unmount (~:251).
- Every write is preceded by a local snapshot: `apps/desktop/src/projects.ts` `writeAtomic()`
  ~:299-316 → `apps/desktop/src/revisions.ts` `snapshotBeforeWrite()` ~:155-173. Snapshots
  live OUTSIDE the project, in Electron `userData`:
  `~/Library/Application Support/Posterract/revisions/<projectId>/<path with / as _>/<timestampMs>-<hash>.snap`
  plus `revisions/projects.json`. 50 snapshots per file, ≤5 MB each (`revisions.ts` ~:20-21).
  **Nothing in the UI exposes these yet** (Phase 1 builds that).

### 1.4 Runtime facts (what already exists)

- Element vocabulary (`packages/posterract-composition/src/types.ts`; canonical tag list in
  `src/source.ts` `COMPOSITION_TAGS` ~:91; runtime registry
  `packages/posterract-video-reconciler/src/elements.ts` ~:94-128):
  structure `stage, scene, group, sequence, adjustmentLayer`; nodes `rect, text, textRange,
  video, image, audio, captions, html, surface`; diagram `diagramNode, diagramArrow,
  diagramEquation, diagramAxis, diagramPlot, diagramCallout`; paints `solidPaint,
  linearGradientPaint, radialGradientPaint, colorStop, imagePaint, videoPaint, htmlPaint,
  shaderPaint (+ uniform), surfacePaint`; styles `stroke, shadow, effect`; motion `animation,
  keyframeTrack, keyframe`.
- 22 animatable properties (`AnimatableProperty`, types.ts ~:86-108): x, y, offsetX,
  offsetY, width, height, rotation, scale, scaleX, scaleY, opacity, cornerRadius (+4
  corners), volume, color, offset, blur, value, **progress** (diagram draw-on; added Sept 2026).
  Mapping to traits: `packages/posterract-video-reconciler/src/document.ts` `TRACK_PROPERTIES`
  ~:166-189. Easing presets `EASINGS` ~:228-237.
- Motion is a pure function of the frame: `packages/posterract-video-runtime/src/systems/motion.ts`
  (`resetAnimatedValues` ~:30, `applyAnimation` presets ~:72-188, `motionSystem` ~:190-252,
  `resolveEasing` ~:380-417, `sampleTrack` ~:423-477). 14 preset animations (fade, gain, grow,
  shrink, blur, slideLeft/Right/Up/Down, spin, twist, appearWord, appearChar, scramble).
  5 clip transitions (dissolve, slideFromRight/Left, fadeToBlack/White) — a `transition` PROP
  on sequence children, not an element (`utils/transition.ts`, `systems/playback.ts` ~:395-414).
- Rendering is Canvas2D (`systems/render.ts`; diagrams ~:808-950); WebGPU only for
  `<shaderPaint>` (`media/shader.ts`). `<html>` uses Chromium's html-in-canvas; `<surface>`
  hands a canvas to project code (three.js/WebGPU work through it).
- `useTicker()` (`packages/posterract-composition/src/hooks.ts` ~:46) exposes time/frame and
  `hold(promise)`. There is **no `useResolution()`** yet (Phase 7).
- Export re-mounts the module in a fresh offline world and steps frames through the same
  motion system: `apps/editor-sandbox/src/engine/capture.ts`,
  `packages/posterract-video-encoder/src/encoder.ts` (frame loop ~:251-301, awaits all frame
  promises ~:449-458). Containers mp4/webm/ogg/mov; codecs avc/hevc/vp9/av1/vp8; audio aac/opus.
- `@inspect` variables: JSDoc-annotated top-level consts become inspector controls
  (`packages/posterract-composition/src/inspect.ts`, UI `inspector/variables.tsx`, written back
  via `SourceVariable`).

### 1.5 The editor UI map (`apps/editor-sandbox/src/`)

- `pages/project.tsx` (provider chain incl. `AiProvider dir={…}`), `pages/editor.tsx`.
- `components/sidebar-left/` — project header, **`AI Generate`** launcher (`components/genai/`),
  `AI Agent` launcher (`components/posterract-code-panel.tsx`), assets library
  (`assets.tsx`: import ⌘I, drag-drop, folders, filters), `project-menu/` (File/Edit/View/Tool
  are mounted; `timeline-menu.tsx`, `text-menu.tsx`, `object-menu.tsx`,
  `preferences-menu.tsx` are UNMOUNTED mockups with no handlers — same upstream).
- `components/canvas/` — canvas, toolbar, `scene-init-overlay.tsx` (empty-project placeholder;
  default preset 16:9 at ~:33), `draw-overlay.tsx`.
- `components/timeline/` — `timeline.tsx` (drop media at time), `layers/` (`layers.tsx` toolbar
  + row heights + time format, `layer.tsx` row dispatch, `node.tsx` row UI incl. hide/mute/solo
  ~:275-321 and context menu ~:338-349, `keyframe.tsx` keyframe rows, `drag.ts` restacking),
  `video-title.tsx` (static active-scene label).
- `engine/timeline/` — `controller.ts` (wheel zoom/scroll), `drag.ts` (clip drag/trim/keyframe
  drag), `snapping.ts` (frame 0, playhead, clip edges; always on), `view.ts` (per-scene
  zoom/scroll), `render/` (`clip.ts` trims/hit tests, `keyframes.ts`, `ruler.ts` (shift-drag
  work area ~:56-68), `snap.ts`, `waveform.ts`, `thumbnails.ts`, `caption.ts`, `marquee.ts`,
  `workarea.ts`).
- `engine/` — `editor.ts`, `history.ts`, `keyframes.tsx` (keyframe CRUD → source ~:81-143),
  `split.tsx` (⌘B blade; wraps halves in `<sequence>` ~:92-132), `timing.ts` (`trimIn`/
  `trimOut` roll `sourceIn/Out` ~:88-106), `overlap.ts`, `group.tsx`, `align.ts`,
  `new-scene.tsx` (`DEFAULT_SCENE_FORMAT` 1920×1080 ~:27), `insert-asset.tsx` (captions from
  transcript assets ~:63-64), `asset-actions.ts` (local files only ~:34; replace ~:53-68),
  `input/shortcuts.ts` (table ~:384-434), `input/interactions.ts`, `library.ts`, `capture.ts`,
  `fonts.ts` (local font access), `camera.ts`.
- `components/sidebar-right/inspector/` — `inspector.tsx` composes sections gated by
  `includesTarget(...)`; sections: time, transform/, layout, appearance (opacity, blend, radius),
  fills/fill-picker/gradient-picker, source (media src), strokes, shadows, effects
  (`effect-types.ts` 8 scalar effects), animations (`animation-types.ts`), transition, masks
  (rect only), audio, captions (`caption-types.ts` 7 presets, `caption-settings.tsx`), diagram,
  text (`text.tsx`: 11 web fonts from `packages/posterract-video-runtime/src/fonts/fixtures.ts`
  + local fonts; caption text editing explicitly disabled ~:114), interpolation (curve editor),
  variables, alignment, export (`export.tsx`, `export-templates.ts`), scene-template
  (`lib/layout-presets.ts` 20 size presets incl. 9:16), `inspector-header.tsx`.
  `marker.tsx` and `styles-modal.tsx` are unmounted mockups.
- `components/sidebar-right/soundboard/` — audio mixer (2 channels + master, dB faders, meters).
- `components/dashboard/projects-view.tsx` — launcher: create/open/rename/duplicate/delete
  (delete has a confirm dialog ~:367-394), sort/search, 11-project cap (`MAX_VISIBLE_PROJECTS`).
- `context/` — `export.tsx` (export flow, ⌘E, ⇧⌘E PNG, `posterract-export-complete` message
  ~:120-126, progress ~:182-189), `ai.tsx` (BYO generation state), `agent-api/` (the renderer
  side of the MCP tools: `api.tsx` router, `canvas.ts`, `context.ts`, `media.ts`, `check.ts`,
  `capture.ts`, `session.ts`), `layout.tsx`, `render.ts`.
- `lib/` — `ipc.ts` (`mainBridge.call(channel, data)` typed by `bridge/main-channels.ts`
  `MainRequestMap`), `ai-bridge.ts`, `reference-image.ts`, `db.ts` (IndexedDB bundle cache).
- `bridge/main-channels.ts` — the editor's mirror of desktop `MAIN_CHANNELS` + request/response
  types. **Adding a main-process channel = add it in BOTH `apps/desktop/src/channels.ts` and
  here, plus a `MainRequestMap` entry, plus a `handle(MAIN_CHANNELS.X, …)` in
  `apps/desktop/src/main.ts`.** Preload needs no change (single private invoke channel).

### 1.6 Desktop main process (`apps/desktop/src/`)

- `main.ts` — window, custom `posterract-app://` scheme, IPC `handle()` registrations (projects
  ~:600-640, AI ~:623-626, files/export authorization ~:667-725 — note the known bug: export to
  a project's own `exports/` is authorized at ~:693-697 but re-checked with a narrower rule at
  ~:722-725), cloud upload gate (`CLOUD_UPLOAD_FILE` ~:579-587 refuses anything not a
  completed export), `capturePage` screenshot ~:592-598.
- `projects.ts` — approved roots, entry resolution, compile/validate/write, scaffold
  (~:355-380: `src/index.tsx`, `package.json`, `assets.yml`, `assets/{video,audio,images,generated}`,
  `exports/`, `AGENTS.md`, `.posterract/{docs,examples,sdk,cache,logs,migrations}`), asset access
  (`readableAssetPath`), watchers, `requireProjectDir()` (exported).
- `revisions.ts` — snapshot store (see §1.3).
- `ai-local.ts` — BYO-keys generation (§1.7).
- `project-control-mailbox.ts` — the agent mailbox consumer (fs.watch + 2 s rescan, 15 s
  heartbeat in `<project>/.posterract/runtime/session.json`, consumed-id memory).
- `local-agent.ts`, `mcp-client-config.ts` — registering `posterract mcp serve` in the user's
  agent clients (Claude Code / Codex / Cursor / VS Code / generic).
- `auth.ts` — desktop auth + cloud transport (60 s timeout; 600 s for `/v1/ai/*` legacy path).

### 1.7 AI = bring your own keys, local only (current state)

- Keys per project: `<project>/api-keys.json` → `{ "minimax": "", "fish": "", "gemini": "" }`,
  gitignored automatically. Entered via the Generate panel (paste + Save) — channels
  `ai:keys-status`, `ai:keys-save`, `ai:keys-reveal`, `ai:generate`.
- `apps/desktop/src/ai-local.ts` calls providers directly from main: MiniMax H3 video
  (`POST https://api.minimax.io/v2/video_generation`, body `{model:"MiniMax-H3", content:[{type:"text",text}, {type:"image_url", image_url:{url}, role:"first_frame"}], resolution:"768P"|"2K", duration:4..15, ratio}`,
  poll `GET /v2/query/video_generation/{task_id}`, download `content.url`); Gemini image
  (`gemini-3.1-flash-image-preview`, `generateContent` with `responseModalities:["IMAGE"]`);
  Fish Audio TTS (`POST https://api.fish.audio/v1/tts`, header `model: s2-pro`, optional
  `reference_id`). Outputs are written to `<project>/assets/generated/gen-<stamp>-<kind>.<ext>`
  and returned as project-relative paths (+ `previewDataUrl` for images).
- Editor: `lib/ai-bridge.ts` (typed calls), `context/ai.tsx` (state), `components/genai/`
  (`generate-panel.tsx` — Image/Video/Voice tabs, reference-image chip for image-to-video,
  results list, "Add to canvas", "Animate" from image results, apply-to-element targeting;
  `insert-generation.tsx`; `lib/reference-image.ts` downscales a frame to a ≤1 MB JPEG data URL).
- The Generate launcher lives in the LEFT sidebar only. The founder explicitly rejected a
  per-component AI section in the right inspector — do not add one.

### 1.8 Agent bridge (`packages/posterract-cli/`)

- `src/mcp.ts` registers 28 tools (connection_status, get_context, get_canvas_state,
  read/write_source, validate, check, capture, screenshot, select, seek, set_properties,
  set_text, create_element, set_variable, move, delete, duplicate, group, ungroup, undo, redo,
  activate_video, export, media_probe/grab/filmstrip/waveform). Requests travel via the project
  mailbox (`<project>/.posterract/runtime/{requests,responses}`) to Electron main and on to the
  renderer router `apps/editor-sandbox/src/context/agent-api/api.tsx`.
- Project discovery: `src/project-control.ts` ~:96-117 (env vars outrank
  `~/.posterract/runtime/active-project.json`).
- `pnpm probe:bridge` exercises the bridge end to end against the running app.
- The user-facing skill is `posterract-skill/` (staged into the app and installed into the
  user's agent). Its references are thin; upstream's `reference/jsx/*.md` are the model to match.
- Missing today: `get_geometry` (bounding boxes/text metrics at time t), transcription/listen
  tools (removed with the hosted AI), `fetch <url>`.

### 1.9 Build & verification commands

```
# editor
cd apps/editor-sandbox && pnpm check && pnpm build && npx eslint src/<touched files>
# desktop
cd apps/desktop && pnpm typecheck && pnpm test:agent-connection && pnpm test:revisions && pnpm test:mailbox
# runtime packages (each): pnpm check   (composition also: pnpm build)
# CLI
cd packages/posterract-cli && pnpm check && pnpm test
# api (only if touched)
cd apps/api && pnpm test && pnpm typecheck
# web (only if touched)
pnpm --filter @posterract/web typecheck && pnpm --filter @posterract/web build
# agent bridge regression (needs the desktop app running with a project open)
pnpm probe:bridge
```

### 1.10 Rebuild + relaunch the desktop app (founder sees changes only after this)

```
osascript -e 'tell application "Posterract" to quit'; sleep 3
pnpm --filter @posterract/desktop package            # typecheck → stage sdk/cli/skill → main/preload → renderers → electron-forge
rm -rf /Applications/Posterract.app
ditto apps/desktop/out/Posterract-darwin-arm64/Posterract.app /Applications/Posterract.app
open /Applications/Posterract.app
```
Verify a change is really in the bundle by grepping a unique UI string in
`/Applications/Posterract.app/Contents/Resources/app/renderer/editor-sandbox/assets/*.js`
(renderer) or `.../app/dist/application.cjs` (main). Restart the user's agent clients if the
CLI changed. The founder's projects live in `~/Movies/Posterract Projects/`.

### 1.11 Known gotchas

- The timeline only rows certain kinds (see Phase 2). The empty-project default scene is 16:9.
- `read_source` default path is `"auto"` (resolves the entry). Migrated projects keep
  `index.tsx` at root; scaffolded ones use `src/index.tsx`.
- Deleting a scene has no confirmation; the last-deleted content is only in snapshots.
- Per-platform export presets ("TikTok", "Reels", "Shorts") are byte-identical to 1080p.
- `<html>` CSS/WAAPI animations run wall-clock in preview but are pinned to composition time
  in export (`systems/playback.ts` ~:203-210) — preview ≠ export for those.
- Captions are import-only (.srt/.vtt/.json → `<captions src>`); their text can't be edited.
- `compileState` in `get_context` reports "unknown" (real state is trapped in editor closures).
- Renderer CSP restricts network; provider/network calls belong in desktop main.
- Fastify JSON body limit is 1 MiB (only matters for the web API).

---

## 2. Non-negotiable principles

1. **Local-first exports.** Renders land in the user's local Exports library. The only path to
   the cloud is an explicit Schedule / Post-now. Never auto-upload.
2. **Trust layer is local.** Snapshots, version history, trash, undo — all on the user's
   machine. Nothing about the document goes to the VPS.
3. **Total connection.** If it is in the source, it is a row on the timeline. If it is a row,
   it is editable. If you edit it, it is written to the source. No hidden edits of any kind.
4. **BYO keys, local execution.** User's keys, user's machine, results frozen into the project.
5. **Determinism.** Preview == export. Never introduce wall-clock-dependent state into the
   composition path.
6. **Agent-native.** Every capability the UI gains must also be reachable by the agent (MCP
   tool or source construct) and documented in the skill.

---

## 3. Phases

Effort figures are for one capable agent including verification and rebuilds.

### Phase 1 — Trust layer (local) · ~3 h

**Goal.** The user always knows their work is saved and can always get it back.

**Current state.** Autosave is real (every edit streams to source) but invisible; snapshots
exist with no UI; scene deletion is unconfirmed; undo resets on reload.

**Design.**
- Header "Saved" pill (editor top chrome, near the zoom readout in
  `inspector/inspector-header.tsx`): states *Saving…* (writer has pending edits),
  *Saved · just now / 2 min ago*, *Save failed — retry* (writer reported `skipped/error`).
- **Version History panel** (right inspector when nothing is selected, above Variables; also
  File menu → "Version history…"): list of snapshots for the entry file, newest first, each
  with timestamp, byte size, a thumbnail (render the snapshot's first scene via the existing
  capture path if cheap; otherwise show the diff summary: elements added/removed/changed), and
  a **Restore** button. Restore = write the snapshot content through the normal source write so
  it is itself snapshotted (never lose the current state).
- **Delete confirmation + Trash** for scenes with content: an `AlertDialog` (the launcher's
  project-delete dialog in `dashboard/projects-view.tsx` ~:367-394 is the pattern) when
  deleting a `<scene>` that has children; deleted scenes go to a per-project Trash
  (`.posterract/trash/<timestamp>-<sceneId>.tsx` containing the scene's source) with a
  "Restore" list in the Version History panel.
- **Persistent undo:** persist `EditHistory` entries (they are source edits addressed by stable
  ids) to `.posterract/cache/history.json` on each push; on mount, if the file's revision id
  matches the one recorded, reload the stack instead of `reset()` (`pages/editor.tsx` ~:168).
- Remove or disable the unmounted mockup menus (`project-menu/{timeline,text,object,preferences}-menu.tsx`,
  `inspector/marker.tsx`, `inspector/styles-modal.tsx`, `ui/search-placeholder.tsx`) so nothing
  advertises features that don't exist. Phases 3 and 6 reintroduce the real ones.

**Implementation steps.**
1. Desktop: add channels `revisions:list {dir, path}` → `[{id, at, bytes, hash}]`,
   `revisions:read {dir, path, id}` → content, `trash:list/read/restore {dir}`. Implement in a
   new `apps/desktop/src/revisions-api.ts` using `revisions.ts` internals; mirror channels in
   the editor bridge map.
2. Editor: `context/save-state.tsx` subscribing to the edit writer (extend `projects/edits.ts`
   to expose pending count + last result); pill in `inspector-header.tsx`.
3. Editor: `components/sidebar-right/inspector/version-history.tsx`; mount in `inspector.tsx`
   under the `includesTarget("stage")` branch (the "No layer selected" state) and in
   `file-menu.tsx`.
4. Editor: intercept scene deletion in `engine/input/shortcuts.ts` delete handler and the
   layer context menu → confirm → write trash file via a `trash:put` channel → then remove.
5. Persistent undo per design.
6. Remove mockup menus.

**Acceptance.** Edit → pill shows Saving… then Saved. Version History lists ≥1 entry after an
edit; Restore brings back a prior state and creates a new snapshot. Deleting a scene with
content asks first; restoring from Trash re-adds it. Reload the project → ⌘Z still works.

---

### Phase 2 — Total connection: every edit is a row, every row is code · ~7 h

**Goal.** The timeline is a complete index of the document; every kind of edit is visible,
editable, and round-trips to source.

**Current state (verified).** `packages/posterract-video-runtime/src/queries/timeline-index.ts`
`buildTimelineLayers()` ~:29-85 creates rows only for: keyframe tracks; masks; entities with
`Geometry`/`Group`/`AdjustmentLayer`; and other children ("sub-items": paints, effects,
strokes, shadows, animations) **only when they contain keyframe tracks** (`isExpandable`).
Inside a `<sequence>`, children without keyframes are skipped as rows (drawn inline as clips in
the sequence row). Consequences: static `<effect>`, `<shaderPaint>` + `<uniform>`, preset
`<animation>`, `<stroke>`, `<shadow>`, gradient paints/`<colorStop>` never appear; motion
computed in code (`useTicker`, `createEffect`) is invisible; user components (`<Panel>`,
`<Flash>`, …) compile away so their boundaries/names are lost; transitions are a prop with no
row or handle.

**Design.**
- **Detail switch** in the timeline toolbar (`components/timeline/layers/layers.tsx`):
  *Clips* (today's view) · *Animation* (adds keyframe tracks + animation ramps) · *Everything*
  (adds every child entity). Persist per user (`createStoredSignal` pattern used in
  `inspector/time.tsx` ~:110-112).
- **New row kinds** in `TimelineNode.kind`: `'effect' | 'paint' | 'stroke' | 'shadow' |
  'animation' | 'uniform' | 'transition' | 'caption-cue' | 'component' | 'live'`. Each renders
  a compact row: label (e.g. "Blur · 8px", "Shader: Glitch", "Fade in · 0.5s"), the span it
  applies to (animations draw as in/out ramps over the parent's span; effects/paints span the
  parent), and is selectable (selecting an effect row selects that entity so the existing
  inspector edits it — inspector already supports these entities).
- **Sequence sub-rows:** in *Animation/Everything*, a sequence row becomes expandable; each
  clip child gets a sub-row group with its own effects/animations rows.
- **Transitions:** draw a handle at each cut inside a sequence row; click → selects the
  outgoing clip and opens the Transition section; drag its width → writes `transition.duration`
  (a `PropEdit` on the clip's `transition` prop, partial-merge semantics already supported).
- **Component groups:** at compile time, record the authoring component name on each element.
  In `packages/video-compiler/src/compiler.ts` (the source-stamping Babel plugin), when a JSX
  element is emitted inside a function component body (not the default export), add a
  `data-component="<Name>"` style attribute mapped to a new `Component` trait via the
  reconciler. `buildTimelineLayers` groups consecutive siblings sharing the same component
  instance (use component name + call-site stamp) under a collapsible `'component'` row named
  after the component. Editing children still writes to the primitive elements (unrolling
  applies if produced by loops).
- **Live lane (code-driven motion):** the reconciler can detect a property written by reactive
  code (a prop set from a signal/memo rather than a literal/keyframe): track a `Computed`-source
  flag per prop (the Solid universal renderer's `setProp` path knows when a value is reactive).
  For such props, show a `'live'` row under the element drawn as a value sparkline sampled
  across the scene (sample by stepping the offline world — reuse `engine/capture.ts` frame
  stepping at low resolution, cached per source revision). Provide **"Bake to keyframes"** on
  the row: sample the property at every frame in the element's span, simplify (Ramer–Douglas–
  Peucker within 0.5 px/1 %), and insert a `<keyframeTrack property=…>` with `<keyframe>`
  children via `engine/keyframes.tsx` writes; the track then wins over the code value (existing
  precedence) so the motion becomes timeline-editable. Show a note "Baked from code — the
  original expression is still in the source."
- **Reveal in code / reveal on timeline:** row context menu "Reveal in code" opens the source
  in the user's editor at the element's line (the desktop already knows the element→line map
  from stamping; add `source:locate {dir, id}` → `{path, line}` and use
  `APP_OPEN_PROJECT_EDITOR` or `shell.openPath`). Conversely, `posterract_select` from the agent
  already selects rows.
- **Captions cues** as rows under a `<captions>` element (needed by Phase 6).

**Implementation steps.**
1. Runtime: extend `TimelineNodeKind`, `buildTimelineLayers` (respect the detail level passed
   in), `isExpandable`; add `Component` trait + reconciler mapping; add live-prop detection flag.
2. Compiler: component-name stamping; keep stable ids unchanged.
3. Editor timeline: renderers for new kinds in `engine/timeline/render/*` (clip.ts draws spans;
   a new `subrow.ts` for compact rows; ramps for animations; transition handles); row components
   in `components/timeline/layers/` (`layer.tsx` dispatch; new `subrow.tsx`, `component-row.tsx`,
   `live-row.tsx`); selection/hit-testing for handles.
4. Bake-to-keyframes: `engine/bake.ts` (sampling via an offline world; RDP simplify; write
   tracks through `engine/keyframes.tsx`).
5. Reveal-in-code channel + menu items.
6. Agent parity: `posterract_get_context` tree should include the new kinds and the component
   name; add a `posterract_bake_keyframes {id, property}` tool.
7. Docs: update the skill's timeline reference.

**Acceptance.** Open the founder's Kagurabachi project (`~/Movies/Posterract Projects/test_project`):
in *Everything*, every `<effect>`, `<shaderPaint>`/`<uniform>`, `<animation>`, `<stroke>`,
gradient, and sequence clip appears as a row; `<Panel>`/`<Flash>`/`<Glitch>` appear as named
groups; `useTicker`-driven props show a live lane; "Bake to keyframes" on one produces a track in
the source and the motion is unchanged frame-for-frame (capture before/after at 3 timestamps and
compare). Selecting any row edits it in the inspector and the edit lands in the source.

---

### Phase 3 — NLE fundamentals · ~6 h

**Goal.** Standard editing muscle memory works.

**Current state.** Trim edges (`engine/timeline/render/clip.ts` ~:138-168, `drag.ts` ~:139-189),
blade ⌘B (`engine/split.tsx`), snapping (always on), marquee/shift-select, restack by drag,
hide/mute/solo, keyframe rows, row heights, work area (shift-drag ruler), wheel zoom/scroll.
Missing: ripple, slip/slide, markers, in/out, J/K/L, Home/End, time nudge, snapping toggle,
layer lock, transition-by-drag, fades/crossfade/ducking, timeline zoom keys, scene switcher.
Shortcut table: `engine/input/shortcuts.ts` ~:384-434 (`A/D` ±1 frame, `W/S` ±1 s, Space play,
arrows nudge canvas XY).

**Design + steps.**
1. **Ripple:** `engine/ripple.ts` — `rippleDelete(clip)` removes and shifts later siblings in the
   same parent/sequence by the removed duration; `rippleTrim` = trim + shift. Shortcuts: ⇧Delete
   ripple delete; ⌥-drag on a trim handle = ripple trim. Writes are batched `PropEdit`s of
   `start`/`end` on siblings (one undo step: wrap in the history's coalescing group).
2. **Slip / slide:** slip = drag inside a clip with ⌥ held → adjust `sourceIn/sourceOut` by the
   same delta keeping `start/end`; slide = ⌥⌘-drag → move the clip and counter-trim neighbours.
   Implement in `engine/timeline/drag.ts` next to `applyTrim`.
3. **Markers:** new composition element `<marker time name color?>` valid under `<scene>`
   (contract: `types.ts`, `source.ts` tags, reconciler registry, trait `Marker`); rendered on the
   ruler (`render/ruler.ts`); `M` adds at playhead; double-click renames; markers are rows in
   *Everything*; `posterract_create_element` covers the agent path; Phase 7's activity log uses
   markers for notes.
4. **In/out points:** bind `I`/`O` to the existing scene `workarea` (source-persisted);
   `⌥X` clears; export range option "work area" (Phase 9 export panel).
5. **Transport:** `J/K/L` (reverse ×1/×2/×4, pause, forward ×1/×2/×4 — reverse playback:
   step frames backwards at the chosen rate; audio muted in reverse), `Home/End`, `⇧Space` play
   from in-point, `↑/↓` jump to previous/next cut, `,`/`.` trim selected edge one frame,
   `⌥←/→` nudge selected clip ±1 frame in time (`⌥⇧` ±10). Add a **shortcut cheat sheet**
   (`?`) and mount the unused command palette primitive (`components/ui/command.tsx`) as ⌘K
   with every action.
6. **Snapping toggle** (`N`, toolbar button; hold ⌘ to bypass) in `engine/timeline/snapping.ts`.
7. **Layer lock:** `Locked` trait + `locked` prop persisted in source; locked rows ignore
   drag/trim/delete; button next to hide/mute in `layers/node.tsx`.
8. **Transition by drag:** a "Transitions" chip strip in the timeline toolbar; drag onto a cut
   handle (Phase 2) → writes `transition={{type}}` on the outgoing clip.
9. **Audio:** fade handles at clip ends → write `<animation type="gain" phase="in|out"
   duration>` (already a runtime preset); crossfade = two gains + overlap; **auto-duck**: a
   scene-level `<duck target="music" by="voice" amount dB attack release>` element implemented
   in `systems/playback.ts` audio bus as a sidechain envelope (deterministic per frame);
   inspector controls; mixer gets per-strip mute/solo and N channels.
10. **Timeline zoom keys** (`⌥+/−`, `⇧Z` zoom to fit, `⌥Z` zoom to selection) + a scrollbar.
11. **Scene switcher:** replace the static `video-title.tsx` with a dropdown listing top-level
    scenes (thumbnail, name, duration; reorder by drag → `MoveEdit`; "Duplicate", "Delete
    (with confirm)").

**Acceptance.** Each shortcut works and appears in the cheat sheet and palette; ripple delete
closes gaps and is one undo; markers persist in source and survive reload; ducking is audible
in preview and identical in export; scene switcher navigates.

---

### Phase 4 — Local Exports library · ~2 h

**Goal.** Every render has a home on the user's machine; the cloud is opt-in per video.

**Current state.** Export writes to a save-dialog path (restricted to Downloads/Videos/
Documents) or `<project>/exports/`; the completion message carries only
`{path, fileName, contentType, durationMs}` (`context/export.tsx` ~:120-126); the desktop
records completed export paths (`main.ts` ~:110) and only those can be uploaded.

**Design + steps.**
1. Desktop: an `exports.json` index in userData (`{id, projectId, sceneId, sourceRevision,
   path, fileName, durationMs, width, height, createdAt}`) appended on every completed export;
   channels `exports:list`, `exports:reveal`, `exports:delete` (moves to Trash).
2. Include `projectId`, `sceneId`, `sourceRevision`, `width`, `height` in the export-complete
   message and in `cloud:upload-file` (this is the provenance Phase 10 needs; store it as
   metadata on the uploaded media asset — web/API change is in Phase 10).
3. Fix the export authorization mismatch so a project's `exports/` folder works for any project
   location (`main.ts` ~:693-697 vs ~:722-725).
4. Editor/dashboard: an **Exports** view (left sidebar tab in the editor + a section on the
   launcher): thumbnails, project/scene, duration, size, date; actions *Schedule / Post now*
   (opens the existing compose handoff with the artifact; upload happens only here), *Reveal in
   Finder*, *Rename*, *Delete*. Copy in the export-complete modal: "Saved to your computer.
   Nothing was uploaded."
5. Export panel: an "Also add to Exports library" default-on; "Open containing folder" after
   export.

**Acceptance.** Export → appears in the Exports library with correct metadata; no network
request fires on export (check the desktop's request log); Schedule from the library uploads
and lands in Compose with the artifact preselected.

---

### Phase 5 — Lottie + vector motion graphics · ~6 h

**Goal.** Full vector animation in the editor without first building a path engine, and a
path to native vectors.

**Facts.** `github.com/diffusionstudio/lottie` (MIT) is a standalone "Text-to-Lottie" product:
an agent skill (`skills/text-to-lottie/SKILL.md` + 14 recipe references + a Lottie spec map)
and a Skia/CanvasKit **Skottie** player (`src/lib/canvaskit.ts`, `scripts/copy-canvaskit.mjs`,
scenes at `public/projects/<p>/<scene-N>/lottie.json` with `controls.json` slots; native text
layers with scene fonts). Their editor has no Lottie element. Lottie gives: bezier paths,
ellipses, polystars, trim paths (draw-on), path morphing, mattes/masks, precomps, time remap,
gradients, slots (editable values).

**Design + steps.**
1. Runtime: new node `<lottie src="…json" width height start end loop? speed? slots?>`:
   reconciler registry + trait `Lottie`; a `media/lottie.ts` that loads CanvasKit (vendor the
   WASM into `packages/posterract-video-runtime/assets/`, copied via a script like upstream's
   `copy-canvaskit.mjs`), creates a Skottie animation per asset, and on each frame seeks it to
   the composition-local time (`localTimeInSeconds` from `Computed`) then renders to an
   offscreen canvas that `render.ts` composites like an image paint. Determinism: seek by
   frame, never `play()`. Export: works unchanged because the frame loop drives the same path;
   register any async load with `hold()` semantics (`encoder.ts` awaits frame promises).
2. Slots: expose Lottie `slots` as animatable/inspectable properties (`<lottieSlot name value>`
   children keyframable via `value`); colors and text slots editable in a Lottie inspector
   section.
3. Asset pipeline: `.json` with `v`+`layers` probes as `LOTTIE` (`packages/posterract-video-assets/src/probe.ts`),
   drag-drop inserts `<lottie>`, thumbnail = frame 0 render; "Import from LottieFiles" = paste a
   URL → download to `assets/lottie/` (desktop main fetch).
4. Timeline: `<lottie>` is Geometry (row like a video); slots appear as rows in *Everything*.
5. Agent: adopt the MIT text-to-lottie skill into `posterract-skill/references/lottie.md`
   (recipes + spec map) with our authoring loop: write JSON into `assets/lottie/`, insert
   `<lottie>`, verify with `posterract_capture`. Add `posterract_create_element` support for
   `lottie`.
6. Native vectors (second half): `<path d=…>` (SVG path syntax), `<ellipse>`, `<polygon>` with
   fills/strokes; `trim` (start/end 0–1, keyframable) for draw-on; `morph` between paths with
   equal command counts; `stagger` on groups/animations (compiled to per-child keyframe offsets
   at mount, no source expansion); relative timing `after="<id>"` / labels resolved at stamp.
   Mask children accept `<path mask>`; feather via canvas blur on the mask layer.

**Acceptance.** Drop a LottieFiles JSON → plays, scrubs frame-accurately, exports identical
to preview; a slot keyframed on the timeline changes the render; agent-authored Lottie from the
skill renders; `<path>` with `trim` draws on and exports.

---

### Phase 6 — Captions & text · ~5 h

**Goal.** Captions are created, edited, and styled in the app; text has creator-grade controls.

**Current state.** Captions come only from transcript assets (`engine/insert-asset.tsx` ~:63-64;
mimes in `packages/posterract-video-assets/src/probe.ts` ~:25,128); the runtime supports
`<captions>` without `src` meaning "transcribe the scene" (`engine/capture.ts` ~:178-180) but
nothing in the UI authors it; caption text editing is disabled (`inspector/text.tsx` ~:114);
7 presets in `inspector/caption-types.ts` ~:28-48 with color slots only for Spotlight/Guinea.
Text: 11 web fonts (`packages/posterract-video-runtime/src/fonts/fixtures.ts`) + local fonts;
size/weight/spacing/line-height/align; no italic/underline/case/rich text.

**Design + steps.**
1. **Cue model in source:** a `<captions>` element may hold `<cue start end>text</cue>` children
   (new element, valid only under `captions`); the runtime prefers cues over `src`. Import of
   .srt/.vtt converts to cues on insert (keep `src` mode for large files with an "Unpack to
   cues" action).
2. **Caption editor:** inspector section for a selected `<captions>`: cue list (time, text),
   inline edit, retime by typing or by dragging cue rows on the timeline (cues are rows —
   Phase 2), split at caret, merge with next, delete; active-word highlight controls (style,
   color, timing offset); max lines / max chars per line; position presets (top/middle/bottom,
   safe-zone aware — Phase 9); export SRT/VTT (desktop channel writes a file).
3. **Auto-captions (BYO key):** "Auto captions" button (captions section + timeline toolbar):
   extracts the scene's audio (existing encoder `offline-audio` mode → wav/opus ≤25 MB),
   sends it from desktop main to the user's chosen transcription provider (add a
   `transcribe` key to `api-keys.json`: OpenAI-compatible `/v1/audio/transcriptions`
   `verbose_json` word timestamps, or Gemini), writes cues into the `<captions>` element, and
   caches by audio content hash in `.posterract/cache/transcripts/`. Also expose as MCP tool
   `posterract_media_transcribe {path}` (BYO, local) so agents get ears.
4. **Style library:** turn the 7 presets into a browsable gallery with live previews; add ≥10
   more (word-pop, karaoke fill, typewriter, boxed highlight, outline pulse, gradient sweep,
   bounce, glow, slide-up lines, emoji-safe); each preset = a `preset` + default color slots +
   default `<animation>`s; user presets saved to `.posterract/styles.json`.
5. **Text:** italic (font style resolution in `engine/fonts.ts`), underline/strike (decoration
   trait rendered in `render.ts`), case (`TextCase` exists), letter/word/line controls,
   `<textRange>` UI for per-run styling, text-on-path (`path` prop referencing a `<path>` id,
   Phase 5), a real font browser (Google Fonts index fetched by desktop main and cached; embed
   used fonts into `assets/fonts/` so exports are reproducible).

**Acceptance.** Import an SRT → cues editable → export SRT round-trips; Auto captions on a
scene with speech produces cues (with a key present) and re-uses the cache on repeat; caption
presets preview live; italic/underline export correctly.

---

### Phase 7 — Agent parity-plus (BYO, local) · ~4 h

**Goal.** Agents can declare generated media in code, hear footage, fetch sources, and QA
layout — without any hosted AI.

**Steps.**
1. **`generate.*` in code on the BYO engine:** in `packages/posterract-composition/src/`
   add `generate.image({prompt, aspectRatio, seed, refs?})`, `generate.video({prompt,
   durationSec, quality, aspectRatio, startFrame?, seed?})`, `generate.voice({text, voiceId?})`
   returning an `AssetRef` usable as `src`. Semantics: pure declarations; on mount the runtime
   resolves each ref by content-hash of its options → if `assets/generated/<hash>.<ext>` exists
   (recorded in `assets.yml`), use it; else ask desktop main (`ai:generate` with the options and
   an `assetHash`) to produce and freeze it, showing a generating placeholder meanwhile.
   Never regenerate an existing hash; `seed` is part of the hash. Chaining: `startFrame: hero`
   resolves the referenced asset first and passes its file as the reference image. Mock/absent
   key → placeholder + `source-error` in `posterract_check`.
2. **Ears:** `posterract_media_transcribe` (Phase 6 backend) and `posterract_media_listen
   {path, prompt?, start?, end?}` (sends the audio window to a multimodal provider with the
   user's key — Gemini supports audio input — and returns the answer).
3. **`posterract_fetch {url}`** and CLI `posterract fetch <url>`: yt-dlp wrapper (not bundled;
   detect on PATH, clear install hint), writes into `assets/video/`.
4. **`useResolution()`** in `hooks.ts`: device pixel ratio in the editor, export scale during
   export (set by the encoder before the first frame; accessor, not constant) — mirror
   upstream semantics; use it in `<surface>` examples.
5. **`posterract_get_geometry {ids?, time?}`**: rendered bounding boxes (post-transform),
   z-order, and text layout metrics (lines, overflow) from the runtime's transform system —
   agents check overlap/clipping from data.
6. **Agent activity + diff:** the agent panel (`posterract-code-panel.tsx`) gains an activity
   log (tool, target ids, time) fed by `AGENT_RECORD_ACTIVITY`; selecting an entry highlights
   the touched elements on the canvas; "Undo this turn" reverts the edits recorded for that
   tool call (group them in history by activity id).
7. **Agent recipes:** buttons in the agent panel that send a prompt to the connected agent
   client via its CLI (Claude Code/Codex accept a prompt argument): "Cut the silences",
   "Caption this scene", "Make three hook variants", "Match this reference".
8. Register every new tool in `packages/posterract-cli/src/mcp.ts`, document in
   `posterract-skill/references/mcp.md`, extend `scripts/probe-bridge.mjs`.

**Acceptance.** A project declaring `generate.image` renders a placeholder, produces the asset
once with a key present, and never again on reopen; `get_geometry` reports correct boxes for
three elements at two timestamps (compare against a capture); the activity log shows a tool
call and undoes it.

---

### Phase 8 — Docs & examples · ~3 h

**Goal.** A user's agent knows everything the runtime can do.

**Steps.** Rewrite `packages/posterract-composition/docs/*.md` (staged into every project's
`.posterract/docs` and into the skill) to the depth of upstream's `reference/jsx/*.md`: module,
stage, scene, elements (full prop tables), group, rect, text, video, image, audio, paints,
styles, html, surface, shader-paint, media, timing, keyframes, animations, transitions,
sequences, adjustment-layer, audio-sync, captions (cues + auto), diagrams, lottie + vectors,
generate, variables, lifecycle (`useTicker`, `useResolution`, `hold`), markers, errors. Ship
`examples/` in the repo and stage them into `.posterract/examples`: basics, keyframes+springs,
diagrams explainer, captions, lottie, generate chain, ticker, html-in-canvas, three.js
surface, WebGPU surface, shader paint, variables, data-driven batch (Phase 11). Every example
must compile and export (add `pnpm examples:check`).

---

### Phase 9 — 9:16-native · ~4 h

**Steps.**
1. Default new scene = Short-form 9:16 (`scene-init-overlay.tsx` ~:33, `new-scene.tsx` ~:27);
   remember the last-used preset.
2. **Safe-zone overlays** on the canvas per platform (TikTok, Reels, Shorts, Threads) as a
   toggleable View option; geometry from `packages/contract/src/capabilities.ts` (add
   `safeZones` there so web Compose uses the same numbers).
3. **Real platform export presets** in `inspector/export-templates.ts`: aspect enforced (warn
   or offer "Create 9:16 variant"), duration cap warnings from the capability registry, spec
   (h264 high, aac 48 kHz, 30 fps default, bitrate per platform).
4. **Duration budget bar** on the timeline ruler: scene length vs the selected platforms' max.
5. **Hook zone:** shaded first 3 s on the ruler; marker preset.
6. **Cover-frame picker** in the export panel: scrub, pick, export `cover.jpg` alongside; the
   Exports library and Phase 10 upload carry it.
7. **Loudness normalization** to −14 LUFS (offline analysis pass in the encoder; gain applied
   at master) as an export option, on by default for social presets.
8. **Silence remover** (uses the existing waveform silence detection): "Remove silences ≥ N ms"
   → ripple-deletes ranges (Phase 3); **beat markers** (onset detection over the audio bus →
   `<marker>`s) with snap-to-beats.
9. **Aspect variants:** "Create 1:1 / 16:9 variant" duplicates the scene with rule-based
   reframing (keyframed camera on an adjustment layer around the subject box; user adjusts).

---

### Phase 10 — Close the loop · ~6 h

**Steps (web/API/orchestrator).**
1. **Provenance:** `media_assets` gains `project_id`, `scene_id`, `source_revision`, `cover_key`
   (migration `012-provenance.sql`); `cloud:upload-file` and `POST /v1/uploads/multipart` accept
   and store them (Phase 4 sends them).
2. **Performance in the editor:** desktop fetches `/v1/analytics/posts?projectId=…` (new
   endpoint returning per-post views, watch time, retention curve from
   `daily_metric_snapshots`/post metrics — `average_view_percentage`, `full_video_watched_rate`
   are already stored) and the editor draws the retention curve over the scene's timeline plus
   a per-scene performance card.
3. **Notifications:** email on failed/partial publication (`apps/api/src/email.js` templates
   exist for auth mail) + an in-app Signals badge; optional webhook out.
4. **Edit a scheduled post:** `PATCH /v1/posts/:id` (caption, platforms, time) with idempotency;
   Compose loads an existing transmission for editing.
5. **First comment**, **cover selection**, per-platform caption fields — Compose UI + API.
6. **Server-side spec enforcement:** `POST /v1/posts` validates duration/size/aspect/format
   against `packages/contract/src/capabilities.ts` (import it; delete the duplicated limits in
   `domain.js`); Compose preflight adds aspect and hashtag-count checks.
7. Best-time suggestions from the workspace's own snapshots (simple hour-of-week engagement
   histogram).

Deploy only when the founder says so (procedure in `AGENTS.md`).

---

### Phase 11 — Only-possible-here (ongoing)

- **Data-driven batch video:** `posterract render --data rows.csv` maps CSV columns onto
  `@inspect` variables and renders one file per row (the encoder path is already headless via
  the CLI `export`); UI: "Batch from CSV…" in the export panel.
- **Component library:** "Save selection as component" writes a Solid component into
  `components/<Name>.tsx` in the project and replaces the selection with `<Name />`; a library
  panel lists project components; templates gallery = a folder of forkable projects.
- **Git-native:** the project is text — expose "Create version branch" / "Compare versions"
  (diff of the TSX rendered as before/after captures) using a vendored isomorphic-git or the
  system git when present.
- **Watch-folder automation:** CLI `posterract watch <dir>` renders and (only if configured
  with the user's own API key for the scheduler) schedules.

---

## 4. Appendix — new source constructs introduced by this plan

| Construct | Phase | Notes |
| --- | --- | --- |
| `<marker time name color?>` under `<scene>` | 3 | Ruler markers; agent-creatable |
| `locked` prop on nodes | 3 | Layer lock |
| `<duck target by amount attack release>` | 3 | Deterministic sidechain envelope |
| Component stamping (`Component` trait) | 2 | From the compiler; groups on the timeline |
| Baked keyframe tracks | 2 | Ordinary `<keyframeTrack>`s written by "Bake" |
| `<lottie src slots?>` + `<lottieSlot>` | 5 | Skottie-rendered, frame-seeked |
| `<path d trim>`, `<ellipse>`, `<polygon>`, `stagger`, `after` | 5 | Native vectors + timing sugar |
| `<cue start end>` under `<captions>` | 6 | Editable captions |
| `generate.image/video/voice` → `AssetRef` | 7 | Frozen by content hash in `assets/generated` |
| `useResolution()` | 7 | Export-scale-aware surfaces |

New MCP tools: `posterract_bake_keyframes`, `posterract_media_transcribe`,
`posterract_media_listen`, `posterract_fetch`, `posterract_get_geometry`; all existing tools
must keep working (`pnpm probe:bridge`).

New desktop channels: `revisions:*`, `trash:*`, `exports:*`, `source:locate`, `captions:*`,
`ai:transcribe`, `ai:listen`, `fetch:url`, `fonts:*`.
