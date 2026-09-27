<!-- Generated 2026-09-19 by a read-only survey of the repo. File:line references were correct that day; re-check before relying on one. -->

# Posterract editor — complete capability inventory

All paths relative to `/Users/sinapahlevan/CODING PROJECTS/vidtryx`. Base for `apps/editor-sandbox/src` is abbreviated **ES/**.

Legend for parameter kinds: **CLOSED** (enumerated), **NUM** (number + unit/range), **TEXT** (free), **TIME**, **ELEM** (element ref), **ASSET** (asset ref), **BOOL**.

Legend for programmatic entry: **[API]** = plain `(world, args)` function or DocumentEditor method already exists; **[RPC]** = also reachable over the agent-API router; **[UI-ONLY]** = logic lives inside a UI event handler or pointer-drag and would need extracting.

---

## 0. The three layers you're integrating against

1. **`DocumentEditor`** — `ES/engine/editor.ts:279`, obtained via `getDocumentEditor(world)` at `ES/engine/editor.ts:1136`. Everything that changes the document goes through it; it emits `EntityEdit`s (`ES/engine/editor.ts:171`) which the writer turns into source edits and the history turns into undo steps.
2. **Engine action modules** — `ES/engine/*.ts(x)`: plain `(world, …)` functions. These are the best existing "intent executors".
3. **Agent-API router** — `ES/context/agent-api/api.tsx:288` (`createAppRouter`), backed by `ES/context/agent-api/canvas.ts`. Wire types in `packages/posterract-cli/src/cli-channels.ts`.

Element vocabulary (the authoritative closed set of creatable tags + props + enum values) is generated data at `packages/posterract-composition/vocabulary.json`, read through `packages/video-compiler/src/vocabulary.ts` (`propDefinition` :69, `checkProps` :238, `checkTree`).

---

# A. CREATING things

### A.1 Full set of element tags the document accepts (43)

From `vocabulary.json` (`v1`, sdk 0.201.0). This is exactly what `canvasCreate` / `canvasApply{op:"create"}` will accept, because `requireKnownTree` (`ES/context/agent-api/canvas.ts:163`) validates against it:

`stage, scene, group, rect, video, image, audio, text, textRange, sequence, captions, adjustmentLayer, diagramNode, diagramArrow, diagramEquation, diagramAxis, diagramPlot, diagramCallout, solidPaint, linearGradientPaint, radialGradientPaint, imagePaint, videoPaint, colorStop, stroke, shadow, effect, animation, keyframeTrack, keyframe, marker, cue, duck, path, ellipse, polygon, lottie, lottieSlot, htmlPaint, html, shaderPaint, surfacePaint, surface`

**Required props by tag** (from vocabulary; any create intent must supply these):

| tag | required |
|---|---|
| `scene` | `width:NUM`, `height:NUM` |
| `text` | `children` (the words) |
| `video` / `image` / `audio` / `imagePaint` / `videoPaint` | `src: string \| AssetRef` |
| `lottie` | `src:string` |
| `polygon` | `points:string` |
| `path` | `d:string` |
| `captions` | — (but `src` or `<cue>` children needed to show anything) |
| `cue` | `start:TIME`, `end:TIME` |
| `marker` | `time:TIME` |
| `animation` | `type:CLOSED` |
| `effect` | `type:CLOSED`, `value:NUM` |
| `keyframeTrack` | `property:CLOSED` |
| `keyframe` | `time:TIME`, `value:NUM\|string` |
| `solidPaint` / `stroke` / `shadow` / `colorStop` | `color:string` (+ `offset:NUM` for colorStop) |
| `duck` | `target:string`, `by:string` |
| `lottieSlot` | `name:string`, `value:string\|number` |
| `textRange` | `start:NUM` |
| `diagramNode` / `diagramCallout` | `label:string` |
| `diagramEquation` | `expression:string` |
| `diagramPlot` | `points: DiagramPoint[]` |
| `shaderPaint` | `wgsl:string` |

**Not creatable through any UI today** (vocabulary-only, agent/source only): `textRange`, `duck`, `html`/`htmlPaint`, `shaderPaint`, `surface`/`surfacePaint`, `adjustmentLayer`, all six `diagram*` tags, `path` (no draw/pen tool), `linearGradientPaint`/`radialGradientPaint` as *new* fills (only via fill-kind swap), `sequence` as a standalone create (only via wrap).

### A.2 Canvas tools (toolbar + shortcuts)

Tool state is `world.set(Tool, { value: ToolType })`. Toolbar: `ES/components/canvas/toolbar.tsx:32` (`handleToolChange`).

| Capability | Impl | Trigger | Params | Entry point |
|---|---|---|---|---|
| Pick Move tool | `ES/engine/input/shortcuts.ts:331` `selectTool(ToolType.MOVE)` | `V`; toolbar `toolbar.tsx:72`, dropdown `:104` | tool: CLOSED `{MOVE,HAND,SCENE,RECT,TEXT,TEXT_EDIT}` | **[API]** `world.set(Tool,…)`; command `canvas.move-tool` |
| Pick Hand tool | same | `H`; `toolbar.tsx:112`; also Space-hold `shortcuts.ts:263` `takeHandTool` | — | **[API]** cmd `canvas.hand-tool` |
| Pick Frame/Scene tool | same | `F`; `toolbar.tsx:130`; menu `ES/components/sidebar-left/project-menu/tool-menu.tsx:20` | — | **[API]** cmd `canvas.frame-tool` |
| Pick Text tool | same | `T`; `toolbar.tsx:200`; `tool-menu.tsx:24` | — | **[API]** cmd `canvas.text-tool` |
| Pick Shape/Component tool | same | `R`; `toolbar.tsx:145`; `tool-menu.tsx:28` | — | **[API]** cmd `canvas.component-tool` |
| Choose which shape the Component tool draws | `ES/engine/shapes.tsx:64` `setDrawnShape` | toolbar shape dropdown `toolbar.tsx:174-190` | kind: CLOSED `rectangle \| ellipse \| triangle \| diamond \| pentagon \| hexagon \| star \| arrow` (`shapes.tsx:47`) | **[API]** `setDrawnShape(kind)` — but no command id |

### A.3 Draw-to-create (the drag overlay)

`ES/components/canvas/draw-overlay.tsx` — `handlePointerDown :137`, `handlePointerMove :150`, `handlePointerUp :164`. **[UI-ONLY]** — the creation logic (size derivation, scene parenting, naming, font sizing, tool reset) is entirely inside `handlePointerUp`.

| Created | Defaults | Where |
|---|---|---|
| `<scene>` (Frame tool) | click ⇒ `1920×1080`, fill `#000000`, name `getNextName(world,'Scene')`, always parented to `Root`, then `editor.activate` | `draw-overlay.tsx:46-54`, `:228-233`, `:242` |
| `<rect>/<ellipse>/<polygon>` (Component tool) | click ⇒ `300×300`, fill `#E0E0E0`, name = shape label or `Rect`; polygon `points` from `pointsFor(kind,w,h)` (`shapes.tsx:71`) | `draw-overlay.tsx:37-45`, `:238`; `ShapeElement` at `shapes.tsx:89` |
| `<text>` (Text tool) | `fontSize = max(8, round(sceneHeight/22.5))` (`:183`), default 16 outside a scene; click ⇒ no width/height (auto-size), content literal `"Text"`, `color #FFFFFF`; switches tool to `TEXT_EDIT` after | `draw-overlay.tsx:55-63`, `:180-199`, `:236`, `:249` |

Drag geometry: `CLICK_THRESHOLD = 10` px decides click-vs-drag (`draw-overlay.tsx:66`, `:175`). Parenting: scene under pointer via `findSceneAt`, else `Root` (`:142`, `:205-212`). Position for a click is centred on the point (`:201`).

### A.4 Scene creation (non-drawn)

| Capability | Impl | Trigger | Params | Entry |
|---|---|---|---|---|
| Create a scene at a point | `ES/engine/new-scene.tsx:63` `createScene(world, format, options)` | called by drops/imports | `format:{width,height}` NUM; `options.name` TEXT, `options.at` Point, `options.focus`, `options.start` TIME | **[API]** |
| Default new-scene format | `ES/engine/new-scene.tsx:36` `DEFAULT_SCENE_FORMAT = {1080,1920}` | — | — | **[API]** |
| Create scene from a format preset | `ES/components/sidebar-right/inspector/scene-template.tsx:20` `createScene(preset)` | Inspector "Scene" panel while Frame tool is active (`inspector.tsx:155`) | preset: CLOSED, 22 presets in `ES/lib/layout-presets.ts:18` — Video (9:16 1080×1920, 16:9 1920×1080, 1:1 1080×1080, 4:5 1080×1350), Cinematic (21:9 1920×823, 2.39:1 1920×803, DCI4K 4096×2160, 2.00:1 1920×960), Social (IG 1080×1350, X 1200×675, LinkedIn 1200×628, FB 1200×630), Device (iPhone 16/17/Plus/Pro Max, Android, iPad, Laptop, Desktop) | **[UI-ONLY]** — duplicates `createScene` logic inline, centred on the viewport |
| Wrap the selection into a new scene | `ES/engine/group.tsx:130` `wrapSelectionInScene(world)` | `⌘⌥Enter`; `shortcuts.ts:487` | — (bbox derived) | **[API]**/**[RPC]** `canvasGroup{kind:"scene"}` `canvas.ts:216` |

### A.5 Asset-driven creation

| Capability | Impl | Trigger | Params | Entry |
|---|---|---|---|---|
| Insert one asset as its element | `ES/engine/insert-asset.tsx:33` `insertAsset(world, asset, options)` | asset context menu "Insert", canvas drop | `asset:ASSET`; `options.parent:ELEM`, `x/y:NUM`, `start:TIME(s)` | **[API]** |
| — mapping | `VIDEO`/`SEQUENCE` ⇒ `<rect keepAspectRatio><videoPaint src></rect>`; `IMAGE` ⇒ `<rect keepAspectRatio><imagePaint src></rect>`; `AUDIO` ⇒ `<audio>` sized `500×150` (`AUDIO_SIZE` `:26`); `TRANSCRIPT` ⇒ `<captions src>`; `LOTTIE` ⇒ `<lottie src>` at its own size | `insert-asset.tsx:46-70` | | |
| — defaults | `name = getNextName(assetName minus extension)` `:39`; `start` = parent's local playhead `:40`; position centred in parent `:94-107` | | | |
| Insert at playhead | `ES/engine/asset-actions.ts:104` `insertAssetAtPlayhead(world, asset)` | asset context menu `ES/components/sidebar-left/asset-item.tsx:102`, `:157` | `asset:ASSET` | **[API]** |
| Make each media file its own scene | `ES/engine/new-scene.tsx:133` `insertMediaAsScenes(world, media, at, options)` | toolbar Upload `toolbar.tsx:53`; canvas drop `ES/components/canvas/canvas.tsx:71` | `media:ASSET[]`, `at:Point`, gap `SCENE_GAP=200` (`new-scene.tsx:56`) | **[API]** |
| Put sounds into the active scene | `ES/engine/new-scene.tsx:158` `insertSounds(world, sounds)` | same | `sounds:ASSET[]` | **[API]** |
| Assets into one new scene | `ES/engine/new-scene.tsx:94` `insertAssetsInNewScene` | drops with no scene | `assets:ASSET[]`, options | **[API]** |
| Drag-drop onto canvas | `ES/components/canvas/canvas.tsx:33` `handleDropEvent` | drag from asset panel (`ASSET_DRAG_TYPE`) or OS files | drop point, files | **[UI-ONLY]** — the "which assets become scenes vs. get placed" routing is in the handler |
| Import files into library | `ES/engine/asset-actions.ts:32` `importFiles(library, files, folder)`; picker `pickFiles` (re-export `:20`) | toolbar Upload `toolbar.tsx:45`; File menu `ES/components/sidebar-left/project-menu/file-menu.tsx:31` | `accept` string, `folder:TEXT` | **[API]** (needs `File[]` — not plain-args friendly) |
| Import a Lottie by URL | `ES/engine/asset-actions.ts:67` `importLottieUrl(dir, url)` | asset panel | `url:TEXT` | **[API]** |
| Find empty canvas space for a new scene | `ES/engine/placement.ts:69` `findEmptyPlacement(world,w,h,gap)` | used by toolbar upload | NUM | **[API]** |

### A.6 AI-generated media insertion

`ES/components/genai/insert-generation.tsx:33` `insertGeneration(world, kind, output)` — **[API]**. Creates `<image>` / `<video>` (both `keepAspectRatio`, intrinsic size) or `<audio>` (`AUDIO_SIZE`), into `getActiveEntity ?? Root`, at the parent's local playhead, centred (`:68`).

Generation parameters (`ES/lib/ai-bridge.ts:29-32`), panel at `ES/components/genai/generate-panel.tsx`:
- **image**: `prompt:TEXT`, `aspectRatio:` CLOSED `9:16 | 16:9 | 1:1 | 4:3 | 3:4` (`ai-bridge.ts:159`), `resolution:` CLOSED `1K | 2K`. Panel defaults: aspect `1:1`, res `1K` (`generate-panel.tsx:90-91`).
- **video**: `prompt:TEXT`, `aspectRatio:` same CLOSED, `durationSec:` NUM 4–15 (`VIDEO_DURATION` `ai-bridge.ts:161`), `quality:` CLOSED `768P | 2K`, `referenceImage?:` data URL. Defaults `9:16`, 6 s, `768P` (`generate-panel.tsx:94-98`).
- **voice**: `text:TEXT`, `voiceId:` CLOSED (`FISH_VOICES`, `generate-panel.tsx:62`).
- Keys per kind: `KEY_FOR_KIND = {image:'gemini', video:'minimax', voice:'fish'}` (`ai-bridge.ts:37`).
- **[RPC]** `ai.image` / `ai.video` / `ai.voice` (`api.tsx:395-399`), handlers in `ES/context/agent-api/generate.ts`.
- Opening the panel: `openGeneratePanel(prefill)` `generate-panel.tsx:119`; command `ai.generate` registered at `ES/components/shell/voice-bar.tsx:212`.

### A.7 Sub-element creation from the inspector

All **[API]**-shaped in the sense that they're `editor.insertElement(parent, jsx)` — but each default set lives inside a component handler (**[UI-ONLY]** for the defaults).

| What | Default authored | Impl |
|---|---|---|
| Fill (`<solidPaint>`) | `color="#E0E0E0"` | `ES/components/sidebar-right/inspector/fills.tsx:66`, const `:20` |
| Swap a fill's kind | replaces the paint element in place (solid ⇄ gradient ⇄ image/video paint) | `ES/components/sidebar-right/inspector/fill-picker.tsx:113` `replaceFill`, `:125`, `:132`; default solid `#E0E0E0` `:54` |
| Gradient stop (`<colorStop>`) | inserted into the gradient paint | `ES/components/sidebar-right/inspector/gradient-picker.tsx:122`; remove `:147`, remove-all `:193` |
| Stroke (`<stroke>`) | `color="#000000"` | `ES/components/sidebar-right/inspector/strokes.tsx:57`, const `:28` |
| Shadow (`<shadow>`) | `DEFAULT_SHADOW` — color/opacity/blur/offsetY | `ES/components/sidebar-right/inspector/shadows.tsx:64`, const `:32` |
| Effect (`<effect>`) | `type="blur" value=8` (`DEFAULT_EFFECT`, `effect-types.ts:39`) | `ES/components/sidebar-right/inspector/effects.tsx:55` |
| Animation (`<animation>`) | `type="fade" phase="in"\|"out"` (`DEFAULT_ANIMATION`, `animation-types.ts:70`) | `ES/components/sidebar-right/inspector/animations.tsx:128` `handleAppendAnimation` |
| Mask (`<rect mask>`) | `x=y=20` (`MASK_INSET` `masks.tsx:23`), size = parent's computed box else 500×500 | `ES/components/sidebar-right/inspector/masks.tsx:48` |
| Lottie slot (`<lottieSlot>`) | `value=0` | `ES/components/sidebar-right/inspector/lottie.tsx:62` |
| Caption cue (`<cue>`) | from transcript unpack / from transcription | `ES/components/sidebar-right/inspector/cue-editor.tsx:74` (unpack), `:201` (from `media.transcribe`) |
| Keyframe / keyframe track | see F | `ES/engine/keyframes.tsx:81` `writeKeyframe` |
| Marker | see C | `ES/engine/markers.tsx:32`, `:54` |

### A.8 Programmatic creation (already exists)

- `DocumentEditor.insertElement(parent, () => jsx, anchor?)` — `ES/engine/editor.ts:607`. Returns top-level entities; stamps pending sources; emits `InsertEdit`s parent-first.
- `canvasCreate(session, {parentId, beforeId?, element})` — `ES/context/agent-api/canvas.ts:169`; `element: CanvasElementTree` = `{tag, props?, text?, children?}` (`packages/posterract-cli/src/cli-channels.ts:462`). Tag must match `/^[a-z][a-zA-Z0-9]*$/` and pass `checkTree`. Selects what it creates (`:177`). RPC route `canvas.create` (`api.tsx:367`).
- `canvasApply{op:"create"}` — batch, one undo step, ids resolvable across edits within the call (`canvas.ts:287`, id resolution `:311`, `:355`).

---

# B. The DocumentEditor API — every public method

`ES/engine/editor.ts`, class at `:279`, accessor `getDocumentEditor(world)` at `:1136`.

| Method | Signature (line) | What it does |
|---|---|---|
| `onEdit` | `(sink:(edit:EntityEdit)=>void) => ()=>void` `:299` | Subscribe to every edit; writer + history use this. |
| `onRename` | `(l:(ids:Record<string,string>)=>void) => ()=>void` `:310` | Hear `restamp` renames. |
| `editProperty` | `(entity, name:string, value:PropValue, {asWritten?}) => void` `:344` | Write a prop. Also enforces the `place` ⇄ `x/y` exclusion: an `x`/`y` on a placed element drops `place` and `inset` and pins the other axis (`:348-361`); a `place` on a positioned one drops `x`/`y` (`:362-368`). `asWritten` skips that. |
| `editVariable` | `(file:string, name:string, value:InspectValue) => void` `:384` | Commit a live `@inspect` variable; emits `VariableEdit`. |
| `editText` | `(entity, text:string) => void` `:398` | Replace a `<text>`'s content. |
| `reportEdit` | `(entity, name, value, previous?) => void` `:417` | Report a change the caller already made (camera, selection, active). |
| `select` | `(entities: Entity\|Entity[], {extend?}) => void` `:436` | Replace or extend selection. Stage is never selectable. |
| `deselect` | `(entities) => void` `:451` | Remove from selection. |
| `clearSelection` | `() => void` `:457` | |
| `activate` | `(entity: Entity \| null) => void` `:466` | Point the timeline at a scene (or nothing). |
| `unsettle` | `(edit: UnrollEdit) => void` `:570` | Undo a loop unroll the write declined. |
| `insertElement` | `(parent, element:()=>unknown, anchor?) => Entity[]` `:607` | Create elements as a project would author them. |
| `duplicate` | `(entities) => Entity[]` `:674` | Copy subtrees on top of themselves; hops out of enclosing sequences; selection moves to copies. |
| `duplicateInPlace` | `(entities) => {original,copy}[]` `:713` | Copy *in* the same parent, right after the original (used by split). |
| `wrap` | `(entities, element:()=>unknown) => Entity\|null` `:749` | Put the selection inside a new container without rewriting positions. |
| `removeIntrinsicPaint` | `(node) => Entity\|null` `:797` | Turn a `<video>`/`<image>` back into a `<rect>`, dropping `MEDIA_PROPS` (`:267`) and pinning size/span. |
| `retag` | `(node, tag:string, edit?:(props)=>void) => Entity\|null` `:857` | Rewrite an element as another tag, keeping children and pinning the box. |
| `copy` | `(entities) => void` `:891` | Fill the internal clipboard. |
| `paste` | `(parent, anchor?) => Entity[]` `:906` | Paste the clipboard; refuses to paste back into the sequence it came from. |
| `reparent` | `(entity, parent, anchor?) => boolean` `:964` | Move in the tree; guards self/descendant moves; emits `MoveEdit` with inverse info. |
| `remove` | `(entities) => Entity[]` `:1028` | Delete subtrees; captures the subtree for undo (`CapturedNode` `:115`). |
| `restamp` | `(ids:Record<string,string>) => void` `:1071` | Re-stamp pending sources once the write names them. |
| `discardPending` | `(source:string) => void` `:1083` | Drop an element whose insert could not be written. |

Private (not intent-usable directly): `emit :317`, `setSelected :480`, `settle :510`, `subtreeRoots :931`, `spell :950`, `recording :1101`.

---

# C. TIMELINE / TIME operations

### C.1 Plain functions (good intent executors)

| Capability | Impl | Trigger | Params | Entry |
|---|---|---|---|---|
| Split at playhead | `ES/engine/split.tsx:92` `splitAtPlayhead(world) => Entity[]` | `⌘B`; cmd `edit.split` (`shortcuts.ts:490`) | none (uses selection or all children of the active scene — `splitTargets :45`; playhead-overlap filter `splitUnits :63`). Wraps the halves in a `<sequence>` unless the parent is already a group | **[API]** |
| Ripple delete | `ES/engine/ripple.ts:40` `rippleDeleteSelection(world)` | `⇧⌫`; cmd `edit.ripple-delete` (`shortcuts.ts:552`) | none | **[API]** |
| Trim in | `ES/engine/timing.ts:92` `trimIn(world, entity, frame)` | timeline left handle; Time inspector "In" field `time.tsx:158-162` | `entity:ELEM`, `frame:TIME(frames)` | **[API]** |
| Trim out | `ES/engine/timing.ts:108` `trimOut(world, entity, frame)` | timeline right handle; "Out" field `time.tsx:164`; "Length" field `time.tsx:169` | same | **[API]** |
| Move a clip in time | `ES/engine/timing.ts:128` `moveEntityTo(world, entity, frame)` | timeline clip drag | `frame:TIME` | **[API]** |
| Slip (footage moves, clip stays) | `ES/engine/timing.ts:154` `slipEntity(world, entity, frames)` | ⌥-drag a clip (`ES/engine/timeline/drag.ts:136`) | `frames:NUM` signed | **[API]** — but only reachable via drag today |
| Slide (clip moves, neighbours trim) | `ES/engine/timing.ts:192` `slideEntity(world, entity, frames)` | ⌥⌘-drag a clip (`drag.ts:135`) | `frames:NUM` signed | **[API]** — drag-only today |
| Write any time prop | `ES/engine/timing.ts:65` `editTime(world, entity, name, frames\|null)` | everywhere | `name:` CLOSED `start\|end\|sourceIn\|sourceOut`; `frames:NUM\|null` | **[API]** |
| Read authored time | `ES/engine/timing.ts:48` `authoredTime` | — | same | **[API]** |
| Nudge selection in time | `ES/engine/transport.ts:179` `nudgeSelectionInTime(frames)(world)` | `⌥←/→` 1f, `⇧⌥←/→` 10f; cmds `edit.nudge-earlier/-later[-far]` (`shortcuts.ts:543-546`) | `frames:NUM` | **[API]** |
| Seek by frames | `ES/engine/input/shortcuts.ts:343` `seekBy(world, frames)` | `A`/`D` ±1 frame; `S`/`W` ∓1 second (`:507-510`) | `frames:NUM` | **[API]** |
| Seek to start / end | `ES/engine/transport.ts:48` / `:56` | `Home` / `End` | none (respects work area) | **[API]** |
| Seek to prev/next cut | `ES/engine/transport.ts:80` `seekToCut(±1)` | `⌥↑` / `⌥↓` | direction CLOSED `-1\|1` | **[API]** |
| Seek to absolute time | `ES/context/agent-api/canvas.ts:92` `canvasSeek` | RPC only | `time:NUM seconds ≥0` | **[RPC]** `canvas.seek` |
| Play / pause | `togglePlayback(world, scene)` via `ES/engine/input/shortcuts.ts:278` `toggleActivePlayback` | `Space` (press/lift handlers `:283`,`:298`); canvas scene header play button `ES/engine/input/interactions.ts:286` | none | **[API]** — cmd `transport.play` (`shortcuts.ts:562`) |
| Shuttle J/K/L | `ES/engine/transport.ts:141` `shuttleBy(±1)`, pause `:173` | `J`,`K`,`L` | direction CLOSED; rates `SHUTTLE_RATES=[1,2,4]` (`:25`), stepped by repeat press | **[API]** |
| Mark in / out | `ES/engine/transport.ts:99` `setInPoint`, `:109` `setOutPoint` | `I` / `O` | none (playhead) — writes `scene.workarea` in seconds | **[API]** |
| Clear in/out | `ES/engine/transport.ts:120` `clearInOut` | `⌥X` | none | **[API]** |
| Set work area explicitly | `ES/engine/timing.ts:76` `editWorkarea(world, scene, [start,end]\|null)` | ruler ⌥/shift drag `ES/engine/timeline/render/ruler.ts:64`; workarea bar drag `render/workarea.ts:61,91,103`; double-click clears `:65` | `range:[TIME,TIME] frames \| null` | **[API]** |
| Toggle marker at playhead | `ES/engine/markers.tsx:32` `toggleMarkerAtPlayhead(world)` | `M`; cmd `range.marker` | none | **[API]** |
| Add a named marker | `ES/engine/markers.tsx:54` `addMarkerAtPlayhead(world, name) => seconds\|null` | voice-bar "note for your agent" (`ES/context/agent-api/command-resolver.ts:231`) | `name:TEXT` | **[API]** |
| List a scene's markers | `ES/engine/markers.tsx:21` `sceneMarkers` | — | — | **[API]** |
| Snapping on/off | `ES/engine/timeline/snapping.ts:49` `toggleSnapping()`; state `:48`; per-gesture bypass `:54` `setSnapBypass` | `N`; ⌘-held during drag inverts | BOOL | **[API]** |
| Timeline zoom in/out | `ES/engine/timeline/zoom.ts:38`/`:39` (from `zoomTimeline(factor)` `:24`) | `⌥=` / `⌥-` | factor NUM | **[API]** |
| Timeline fit | `ES/engine/timeline/zoom.ts:53` `zoomTimelineToFit` | `⇧Z` | none | **[API]** |
| Timeline zoom to selection | `ES/engine/timeline/zoom.ts:62` | `⌥Z` | none | **[API]** |
| Timeline scroll / resolution | `ES/engine/timeline/view.ts:62` `setScrollX`, `:67` `setScrollY`, `:71` `setResolution` | wheel / drag via `ES/engine/timeline/controller.ts:41` | NUM | **[API]** |
| Timeline detail level | `ES/engine/timeline/detail.ts:29` `setTimelineDetail` | workspace switch, `voice-bar.tsx:163`; options at `detail.ts:18` `TIMELINE_DETAILS` | CLOSED | **[API]** — no command id of its own |
| Sequences: wrap / unwrap | `ES/engine/group.tsx:88` `wrapSelectionInSequence`, `:214` `unwrapSequenceSelection` | `⌘⌥Enter` / `⌘⌥⇧Enter` | none | **[API]**/**[RPC]** |
| Settle sequence overlaps | `ES/engine/overlap.ts:32` `resolveSequentialOverlaps`, `:70` `resolveNewSequenceOverlaps` | after a drag/drop | `dragged:ELEM[]` | **[API]** |
| Reveal a node in the timeline | `ES/engine/reveal-timeline.ts:12` `revealInTimeline(world, target)` | Inspector "Timeline ↗" (`ES/components/shell/selection-actions.tsx:57`) | `target:ELEM` | **[API]** |
| Playback rate (speed) | prop `playbackRate`, written at `ES/components/sidebar-right/inspector/time.tsx:158` | Time panel add-on | NUM (1 = unset) | prop write; reachable via `canvasSetProperties` |
| Frames-directory frame rate | `time.tsx:191` | Time panel, `<image>`/SEQUENCE assets | NUM 1–240 | prop write on the paint source |
| Loop | `<lottie loop>` (`lottie.tsx:81`) and `<keyframeTrack loop>` (CLOSED `repeat\|pingpong`). **No clip-level loop exists.** | | | |

### C.2 Pointer-drag-only timeline gestures — **[UI-ONLY]**

| Gesture | Impl | Notes |
|---|---|---|
| Drag a clip in time | `ES/engine/timeline/drag.ts:95` `beginClipDrag` + `:119` `applyClipDrag`, called from `ES/engine/timeline/render/clip.ts:308-311` | Snap resolution `findSnapDelta` (`snapping.ts:107`); multi-select snapshot at `drag.ts:66` |
| ⌥ slip / ⌥⌘ slide | `drag.ts:131-141` | Modifier read live from `ES/engine/timeline/pointer.ts:66-71` |
| Trim a clip edge | `drag.ts:147` `beginTrim` + `:164` `applyTrim`, from `render/clip.ts:223-225` | Bounds `trimBounds :193` — other edge and available source |
| Select / shift-select clips, marquee | `render/clip.ts:318-326` | |
| Scrub the playhead / ruler | `ES/engine/timeline/render/ruler.ts:54` `setPlayhead` | |
| Drag the work area bar or its handles | `ES/engine/timeline/render/workarea.ts:61,91,103` | |
| Drag a keyframe in time | `ES/engine/timeline/render/keyframes.ts:167` — writes `keyframe.time` | |
| Select keyframes / marquee | `render/keyframes.ts:149-152` | |
| Select an animation "part" | `ES/engine/timeline/render/part.ts:57` | |
| Reorder / reparent layers by dragging rows | `ES/components/timeline/layers/context.tsx:224` `performDrop` → `editor.reparent`; hit-testing in `layers/drag.ts` | 600 ms dwell auto-expands (`context.tsx:24`, `:130-135`) |
| Resize a layer row's height | `ES/components/timeline/layers/node.tsx:143-160` → `editProperty('clipHeight')` | clamped `MIN/MAX_CLIP_HEIGHT` |
| End-of-gesture sequence settle | `ES/engine/timeline/drag.ts:52` `updateDragGestures`, `:80` `endGesture` | |

### C.3 Lock / hide / mute / solo

| Capability | Impl | Trigger | Kind |
|---|---|---|---|
| Lock a layer | `ES/components/timeline/layers/node.tsx:225` `toggleLocked` → `editProperty('locked', bool)` | row lock button `:361` | prop, persisted. **[UI-ONLY]** as a toggle; underlying prop write is scriptable |
| Hide / show | `node.tsx:99` `toggleHidden`; batch version `ES/engine/input/shortcuts.ts:366` `toggleSelectionHidden` | eye button `:406`; context menu `:443`; `⇧⌘H` | **[API]** for the selection version (cmd `edit.hide`) |
| Mute | `node.tsx:94` `toggleMuted` → `editProperty('muted')`; audio panel `ES/components/sidebar-right/inspector/audio.tsx:270` | row button `:377`; context menu `:441` | **[UI-ONLY]** toggle; prop is scriptable |
| Solo | `node.tsx:115` `toggleSoloed` — **trait only, never written to the file**, and exclusive (clears every other `Soloed`) | row button `:392`; context menu `:442` | **[UI-ONLY]**, no prop, no undo |
| Expand / collapse | `node.tsx:104` `toggleExpanded` → `editProperty('expanded')`; also `ES/components/timeline/layers/component-row.tsx:39` | chevron `:320` | prop write |

---

# D. ARRANGE / TRANSFORM

| Capability | Impl | Trigger | Params | Entry |
|---|---|---|---|---|
| Move (drag) | `ES/engine/input/interactions.ts:718` `handleMaskInteraction` → `editTransform(…,[['x',n],['y',n]])` | canvas drag | — | **[UI-ONLY]** |
| Nudge | `ES/engine/input/shortcuts.ts:170` `nudgeSelection(world, dx, dy)`; `NUDGE=1`, `NUDGE_FAST=10` (`:159`) | arrows / ⇧arrows; cmds `canvas.nudge-*` | `dx,dy:NUM px` | **[API]** |
| Set x / y | `editProperty(entity,'x'\|'y',NUM)`; inspector `ES/components/sidebar-right/inspector/transform/transform-settings.tsx:101`,`:106` | X/Y fields | NUM px | **[API]** via `canvasSetProperties` |
| Place (named position) | `transform-settings.tsx:134` `editProperty('place', …)` | Place control | CLOSED: `top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right, upper-third, lower-third` | **[API]** |
| Inset (distance from the placed edge) | `transform-settings.tsx:143` `editProperty('inset', …)` | Place row | NUM px (0 = unset) | **[API]** |
| Resize (drag handles) | `ES/engine/input/interactions.ts:348` `handleResizeInteraction` → `resizeNode :560`; group case `keepGroupPlaced :614`; polygon points rescaled `:591-594` via `scalePoints` (`shapes.tsx:84`) | 8 handles; ⇧ locks ratio (`:383`), ⌥ resizes about centre (`:410`) | — | **[UI-ONLY]** |
| Set width / height | `ES/components/sidebar-right/inspector/layout.tsx:89` `resize({width,height})` → `syncKeyframe` + `editProperty` (`:102`,`:107`) | Layout panel W/H | NUM px; honours `keepAspectRatio` ratio (`:77`) | **[UI-ONLY]** for the ratio logic; plain prop write otherwise |
| Keep aspect ratio | `layout.tsx:120` `editProperty('keepAspectRatio', bool)` | lock button | BOOL | **[API]** |
| Clips content | `layout.tsx:59-66` — **trait only** (`entity.add/remove(ClipsContent)`), never a prop | Layout panel checkbox | BOOL | **[UI-ONLY]**, not persisted |
| Rotate (drag) | `ES/engine/input/interactions.ts:645` `handleRotateInteraction`; ⇧ snaps to 15° (`:690`) | rotation handle | — | **[UI-ONLY]** |
| Set rotation | `ES/components/sidebar-right/inspector/transform/rotate-row.tsx:46` | Rotate field | NUM degrees (0 = unset) | **[API]** |
| Flip X / Y | `rotate-row.tsx:50` `setFlip(axis, ±1)` — **trait `Flip` only, no JSX spelling**, so it is lost on recompile (`rotate-row.tsx:30-33`) | flip buttons | axis CLOSED `x\|y`; value CLOSED `-1\|1` | **[UI-ONLY]**, non-persisted |
| Scale (uniform / per-axis) | `ES/components/sidebar-right/inspector/transform/scale-row.tsx:69-99` | Scale fields | `scale:NUM` (1 unset), `scaleX/scaleY:NUM` | **[API]** props |
| Offset X/Y | `ES/components/sidebar-right/inspector/transform/offset-row.tsx:39`,`:44` | Offset row | NUM px (0 unset) | **[API]** props |
| Skew | `ES/engine/input/interactions.ts:597-604` — written to the `Skew` trait only (comment `:597`: "Skew has no JSX spelling") | produced by multi-node resize | NUM | **[UI-ONLY]**, non-persisted |
| Anchor point | `ES/components/sidebar-right/inspector/transform/anchor-row.tsx:35-75` + `anchor-picker.tsx` — **trait `Anchor`** | Anchor row/picker | x,y NUM 0–1 | **[UI-ONLY]**, non-persisted |
| Constraints | `ES/components/sidebar-right/inspector/transform/constraints-row.tsx:35` — **trait `Constraint`** | two selects | CLOSED `ConstraintType` (`MIN/CENTER/MAX/…`), horizontal + vertical (`transform/constants.ts`) | **[UI-ONLY]**, non-persisted |
| Align (6 ways) | `ES/engine/align.ts:105` `alignSelection(world, action)` | Alignment panel (`inspector.tsx:159-161`, `alignment.tsx`), needs ≥2 selected | `action:` CLOSED `align-left \| align-center-horizontal \| align-right \| align-top \| align-center-vertical \| align-bottom` (`align.ts:34`) | **[API]** — **no command id, no shortcut** |
| Distribute | `ES/engine/align.ts:139` `distributeSelection(world, axis)`, needs ≥3 | Alignment panel | `axis:` CLOSED `x\|y` | **[API]** — no command id |
| Which nodes align touches | `ES/engine/align.ts:47` `getAlignableSelection` — top-level nodes and direct scene children only | | | |
| Bring to front / send to back | `ES/engine/input/shortcuts.ts:382` `restackSelection(world,'front'\|'back')` | `]` / `[`; layer context menu `ES/components/timeline/layers/node.tsx:445`,`:449` (its own `handleReorder :230`) | CLOSED `front\|back` | **[API]** cmds `edit.bring-front` / `edit.send-back` |
| Group | `ES/engine/group.tsx:70` `groupSelection` | `⌘G` | none | **[API]**/**[RPC]** `canvasGroup{kind:"group"}` |
| Ungroup (groups + scenes) | `ES/engine/group.tsx:209` `ungroupSelection` → `dissolveContainers :230` | `⇧⌘G` | none | **[API]**/**[RPC]** `canvasUngroup` |
| Wrap in sequence / scene | `group.tsx:88` / `:130` | `⌘⌥Enter` / `⌘Enter` | none | **[API]**/**[RPC]** |
| Unwrap sequence | `group.tsx:214` | `⌘⌥⇧Enter` | none | **[API]**/**[RPC]** `canvasUngroup{kind:"sequence"}` |
| Reparent / reorder | `DocumentEditor.reparent` `editor.ts:964` | canvas drop-into-scene (`interactions.ts:922` `reparentTo`, 250 ms dwell `:878`); layer drag (`layers/context.tsx:224`) | `entity, parent, anchor?` | **[API]**/**[RPC]** `canvasMove` |
| Fit / fill / cover an image or video | prop `objectFit`, CLOSED `cover \| contain \| fill`; written at `ES/components/sidebar-right/inspector/fill-picker.tsx:270` | Fill picker | CLOSED | prop write |
| Mask | `ES/components/sidebar-right/inspector/masks.tsx:48` inserts a `<rect mask>` | Masks panel + | inset 20, size = parent box | **[UI-ONLY]** defaults |
| **Crop** | **does not exist** — no crop tool, no crop props in the vocabulary. Closest is `objectFit` + a mask. | | | |
| Rename | `editProperty(entity,'name',TEXT)` — layer row inline `ES/components/timeline/layers/node.tsx:256`, canvas header double-click `ES/engine/hud/name-input.ts` via `interactions.ts:318` `mountNameInput` | double-click | `name:TEXT` | **[API]** prop; no command |
| Lock | see C.3 | | | |
| Hide | see C.3 | | | |
| Turn one shape into another | `ES/engine/shapes.tsx:152` `changeShape(world, entity, kind)` (uses `retag`) | Shape picker `ES/components/sidebar-right/inspector/shape.tsx:35` | `kind:` CLOSED (8 shapes) | **[API]** — no command |
| Remove media from a node (→ `<rect>`) | `DocumentEditor.removeIntrinsicPaint` `editor.ts:797` | Source panel `ES/components/sidebar-right/inspector/source.tsx:94` | `node:ELEM` | **[API]** |
| Replace a media node's source | `source.tsx:89` `editProperty('src', asset.path)` | Source panel asset picker | `src:ASSET` | **[API]** prop |

---

# E. STYLE

Inspector components under `ES/components/sidebar-right/inspector/`, mounted by `inspector.tsx:137-266` per `SelectionTarget` (`:62-78`, classifier `:80`).

### Fills / paints — `fills.tsx`, `fill-row.tsx`, `fill-picker.tsx`, `solid-picker.tsx`, `gradient-picker.tsx`
- Add solid fill (`fills.tsx:66`, `#E0E0E0`).
- Swap fill kind: solid / linear gradient / radial gradient / image paint / video paint — `fill-picker.tsx:113` `replaceFill`, tabs `:138+`.
- Solid: `color:TEXT hex` (`solid-picker.tsx:27`), `opacity:NUM 0–1` (`:33`, 1 = unset).
- Gradient: stop `offset:NUM 0–1` (`gradient-picker.tsx:104`), stop `color` (`:110`), stop `opacity` (`:116`), gradient `rotation:NUM` (`:281`); add stop `:122`, remove stop `:147`, remove all `:193`.
- Image/video paint: `src:ASSET` (`fill-picker.tsx:187`), `objectFit:` CLOSED `cover|contain|fill` (`:270`, cover = unset), `blendMode` (`:344`, trait removal `:335`).
- Reorder fills: `fills.tsx:146`,`:148` via paired `reparent` swaps. Hide a fill: `fill-row.tsx:50` `editProperty('hidden')`. Remove: `fills.tsx:178`.
- Text-specific tabs: `fills.tsx:65` (`TEXT_TABS`).
- Node-level `fill` prop (intrinsic solid): `source.tsx:226`/`:232`/`:248`.

### Stroke — `strokes.tsx`, `stroke-inspector.tsx`
`color:TEXT` (`stroke-inspector.tsx:80`), `opacity:NUM` (`:86`), `width:NUM` (`:93`), `join:` CLOSED `miter|round|bevel` (`:98`), `cap:` CLOSED `round|butt|square` (`:102`). Add `strokes.tsx:57` (`#000000`), reorder `:84`/`:86`, hide `:149`, remove `:115`.

### Shadow — `shadows.tsx`, `shadow-inspector.tsx`
`color` (`:62`), `opacity` (`:68`), `offsetX`/`offsetY` (`:73`), `blur` (`:78`). Add `shadows.tsx:64`, reorder `:96`/`:98`, hide `:161`, remove `:127`.

### Effects — `effects.tsx`, `effects-inspector.tsx`, `effect-types.ts`
Type is CLOSED, 8 values with unit + default (`effect-types.ts:27`):
`blur (px, 8)`, `brightness (amount, 0.8)`, `contrast (0.8)`, `grayscale (0.5)`, `hueRotate (deg, 100)`, `invert (0.5)`, `saturate (0.8)`, `sepia (0.5)`.
Set `value` `effects-inspector.tsx:65`; switch `type` `:81` (resets `value` across units `:83`); hide `:88`/`effects.tsx:151`; add `effects.tsx:55`; reorder `:84`/`:86`; remove `:115`; keyframe-track removal on unit change `effects-inspector.tsx:79`.

### Appearance — `appearance.tsx`
`opacity:NUM 0–1` (`:102`, 1 unset); `blendMode:` CLOSED 16 values (`:119`, order in `blend-modes.ts:10`, separators `:30`); `hidden:BOOL` (`:132`); `cornerRadius:NUM` (`:152`) plus the four per-corner props `cornerRadiusTopLeft/TopRight/BottomRight/BottomLeft` (`:160`, `:174`), with keyframe-track cleanup at `:145`,`:159`,`:169`.

Blend-mode closed set (vocabulary): `sourceOver, multiply, screen, overlay, darken, lighten, colorDodge, colorBurn, hardLight, softLight, difference, exclusion, hue, saturation, color, luminosity`.

### Text — `text.tsx`
`editText` (`:191`); `fontFamily:TEXT` (`:150`); `fontWeight:` CLOSED `normal|bold` written as a number (`:163`); `fontStyle:` CLOSED `normal|italic|oblique`; `fontSize:NUM` (`:236`); `leading:NUM` — UI is % and divides by 100, 100 % = unset (`:252`); `letterSpacing:NUM` (`:264`, 0 unset); `textDecoration:` CLOSED `none|underline|lineThrough|"underline lineThrough"` (`:140`, joined words); `textAlign:` CLOSED `left|center|right` (`:328`, left unset); `textBaseline:` CLOSED `top|bottom|middle|alphabetic` (`:334`); `textCase:` CLOSED `original|upper|lower` (`:296`); fixed vs auto size `:171-181` (sets/unsets width+height, clearing their keyframe tracks `:178-179`).

### Text ranges
`<textRange>` exists in the vocabulary with `start` (required), `end`, `color`, `fontFamily`, `fontSize`, `fontStyle`, `fontWeight`, `letterSpacing`, `textCase`, `textDecoration`. **There is no UI for it at all** — agent/source only.

### Vector / shape / diagram / lottie
- `vector.tsx:61`,`:67` — `d`, `morph`, `morphTo`, `trimStart/trimEnd/trimOffset` on `<path>`/`<ellipse>`/`<polygon>`.
- `shape.tsx:35` — shape kind swap (see D).
- `diagram.tsx:56` string props, `:63` `progress:NUM`, `:107` `strokeWidth:NUM 0.5–40`, `:109` `fontSize:NUM 8–220`. Diagram *creation* has no UI.
- `lottie.tsx:74` `speed:NUM`, `:81` `loop:BOOL`, `:62` add `<lottieSlot>`, `:139` slot `value`.

### Stage background
`background.tsx:37` `editProperty(root,'background', color)` — the stage's one editable prop (`editor.ts:375` special-cases its previous value).

---

# F. ANIMATION

### F.1 Presets (`<animation>`)
Panel `ES/components/sidebar-right/inspector/animations.tsx` (mounted only on the **Motion** inspector tab, `inspector.tsx:148-151`).

- Add: `animations.tsx:128` `handleAppendAnimation(phase)` — authors `<animation type="fade" phase="in"|"out">`, expands the layer (`:135`), switches timeline detail to `animation` (`:136`). Buttons "+ Entrance" / "+ Exit" `:169-170`.
- Remove: `animations.tsx:180` `editor.remove(animation)`.
- Parameters (all **[API]** as plain prop writes on the animation entity):
  - `type:` CLOSED 14 values — `fade, gain, grow, shrink, blur, slideLeft, slideRight, slideUp, slideDown, spin, twist, appearWord, appearChar, scramble` (`animations.tsx:282`; grouped for the UI at `animation-types.ts:29` — Fade/Scale/Blur/Text(`text` only)/Audio(`gain`, audio only)).
  - `phase:` CLOSED `in|out` (`:286`, `in` = unset).
  - `duration:` NUM seconds, rounded to the frame (`:291`, `DEFAULT_DURATION` unset).
  - `delay:` NUM seconds (`:296`).
  - `distance:` NUM px — preset-relative, unset when equal to the preset's own (`:314`).
  - `amount:` NUM — same rule (`:319`); which control shows is `AMOUNT_CONTROLS[type]`.
  - `easing:` CLOSED `linear, easeIn, easeOut, easeInOut, gentle, snappy, bouncy, strong` (`:324`; table `easing-types.ts:29`/`:36`).
- Voice-bar/agent shorthand: `canvasApply` create of `{tag:'animation', props:{type, phase, easing?, duration?}}` — see `ES/context/agent-api/command-reading.ts:891-904`.

### F.2 Keyframes — `ES/engine/keyframes.tsx` (all **[API]**)
- `findKeyframeTrack(world, target, property)` `:35`; `findKeyframeAt(track, frame)` `:45`; `keyframeFrame(target)` `:51`.
- `writeKeyframe(world, editor, target, property, value?)` `:81` — inserts `<keyframe time value>` into the track, or creates `<keyframeTrack property>` with it.
- `toggleKeyframe(world, editor, target, property)` `:112` — add, or remove; removes the whole track with the last keyframe (`:123-124`). UI: the diamond button `ES/components/ui/keyframe.tsx:44`.
- `syncKeyframe(…, value)` `:134` — keeps an existing track in step with a direct prop edit. Called by `editTransform` (`interactions.ts:137`), `nudgeSelection`, `align.ts:88/95`, `layout.tsx:104/109`, `rotate-row.tsx:47`, `audio.tsx:295`.
- `removeKeyframeTrack(…)` `:140`.
- `property:` CLOSED 25 values — `width, height, color, opacity, cornerRadius, cornerRadiusTopLeft, cornerRadiusTopRight, cornerRadiusBottomRight, cornerRadiusBottomLeft, x, y, offsetX, offsetY, rotation, scale, scaleX, scaleY, blur, volume, offset, value, morph, trimStart, trimEnd, trimOffset, progress`.
- Track `loop:` CLOSED `repeat | pingpong` — **vocabulary only, no UI**.
- Keyframe `easing:` CLOSED same 8 as animations; edited in `interpolation.tsx:130`.
- Dragging a keyframe in time: `ES/engine/timeline/render/keyframes.ts:167` — **[UI-ONLY]**.

### F.3 Bake
`ES/engine/bake.tsx:85` `bakeToKeyframes(world, editor, target, property, {tolerance?, dir})` — **[API]**, **[RPC]** `canvas.bake` (`api.tsx:369` → `canvas.ts:195`). Returns `{keyframes, sampled}`. Tolerance defaults: `0.25` px/deg, `0.0025` for ratio props (`bake.tsx:57-66`, ratio set `:61`); cap `MAX_FRAMES = 3600` (`:70`).
UI: layer context menu sub-menu, `ES/components/timeline/layers/node.tsx:455-471`; offered properties `BAKEABLE = ['x','y','rotation','scale','opacity','width','height']` (`node.tsx:62`). Handler `node.tsx:172`.

### F.4 Transitions (`transition` prop on a sequence child)
`ES/components/sidebar-right/inspector/transition.tsx:73` — `editProperty('transition', {type, duration})`; remove `:84`. `type:` CLOSED `dissolve, slideFromRight, slideFromLeft, fadeToBlack, fadeToWhite` (`transition-types.ts:16`); `duration:NUM` seconds, default 1 (`transition-types.ts:25`). Shown only when the parent is a sequence (`inspector.tsx:244`).

### F.5 Stagger and duck
- `stagger` is a **prop on `<group>`** (vocabulary) and is consumed by the timeline renderer (`ES/engine/timeline/render/part.ts:25` `getStaggerOffset`). **No inspector control writes it** — agent/source only.
- `<duck>` (`target`, `by` required; `amount`, `attack`, `release`) — **no UI at all**.
- `<cue>` is authored by the caption panel; `duck` is not.

---

# G. CAPTIONS and TRANSCRIPTION

- `<captions>` props: `preset, colors, verticalAlign, src, seed, start, end, sourceIn, sourceOut, playbackRate, offsetX/Y, clipHeight, locked, name, error, after, expanded, selected, id, children`.
- Created today only by inserting a `TRANSCRIPT` asset (`ES/engine/insert-asset.tsx:64`). **There is no "add captions" button or command.**
- Preset: CLOSED 13 — `classic, cascade, spotlight, whisper, paper, guinea, stark, pop, karaoke, typewriter, banner, punch, marquee`. Gallery + switch at `ES/components/sidebar-right/inspector/caption-settings.tsx:56-68`; changing preset clears `colors` first (`:61`) because slots are positional.
- `colors`: positional array per preset slot (`caption-settings.tsx:73-78`); slot definitions and default hexes at `caption-types.ts:30-79`.
- `verticalAlign:` CLOSED `top|center|bottom`.
- Cue editing — `ES/components/sidebar-right/inspector/cue-editor.tsx`:
  - **Unpack a transcript into editable `<cue>`s**: `:63` `unpack()` → `insertElement` `<cue start end>text</cue>` `:74`. **[UI-ONLY]**.
  - **Transcribe the scene's audio into cues**: `:~160-215`, calls `media.transcribe` then groups words (`groupBy(transcript,{duration:2.2})` `:196`) and inserts a `<cue>` per line (`:201`). **[UI-ONLY]**.
  - Edit a cue's text `:260` (`editor.editText`); delete a cue `:266`.
  - **Export subtitles**: `:80` `exportSubtitles(format)`, `format:` CLOSED `srt|vtt`. **[UI-ONLY]**.
- `media.transcribe` — **[RPC]** `api.tsx:393`, handler `ES/context/agent-api/media.ts:116` `handleMediaTranscribe`. Takes `MediaTranscribeRequest`; asserts the asset is `VIDEO`/`AUDIO` (`:119`); returns `{text, words, segments, cached}`.

---

# H. SELECTION / VIEW / NAVIGATION

| Capability | Impl | Trigger | Params | Entry |
|---|---|---|---|---|
| Select / multi-select | `DocumentEditor.select` `editor.ts:436` | canvas click, ⇧-click (`interactions.ts:183`, `:314`), layer row (`node.tsx:135`), timeline clip (`render/clip.ts:325`) | `entities:ELEM[]`, `extend:BOOL` | **[API]**/**[RPC]** `canvas.select` |
| Deselect entities | `editor.ts:451` | | | **[API]** |
| Clear selection | `editor.ts:457`; the shortcut version also resets a drawing tool (`shortcuts.ts:471`) | `Esc`; cmd `edit.deselect` | — | **[API]** |
| Select all | `ES/engine/input/shortcuts.ts:418` `selectAll` — stage's direct children only, skipping hidden/culled | `⌘A` | — | **[API]** cmd `edit.select-all` |
| Select parents | `shortcuts.ts:431` `selectParents` — walks through sequences | `\` | — | **[API]** |
| Select children | `shortcuts.ts:453` `selectChildren` | `Enter` | — | **[API]** |
| Marquee-select on canvas | `interactions.ts:216` `handleCanvasInteraction` `:223-250` | drag on empty stage | — | **[UI-ONLY]** |
| Drill into a container | `interactions.ts:200` (`enterEntity` on dblclick), also `:723` on the mask | double-click | — | **[UI-ONLY]** |
| Activate a scene | `editor.ts:466` `activate` | canvas click into a scene (`interactions.ts:189`, `:270`), header click (`:321`), drop-into (`:932`), scene switcher | `entity:ELEM\|null` | **[API]**/**[RPC]** `canvas.activate` |
| Scene switcher | `ES/components/shell/scene-switcher.tsx:39` → `editor.activate` | dropdown | — | **[UI-ONLY]** wrapper over `activate` |
| Camera zoom in/out | `ES/engine/camera.ts:39` `zoomBy(world, factor)`; `ZOOM_STEP=1.25` (`shortcuts.ts:356`) | `⌘=`/`⌘-`; View menu `view-menu.tsx:25`,`:29` | `factor:NUM` | **[API]** cmds `canvas.zoom-in/-out` |
| Zoom to a scale | `camera.ts:46` `zoomTo(world, scale)` | `⌘0` (scale 1); `view-menu.tsx:33` | `scale:NUM` | **[API]** cmd `canvas.actual-size` |
| Zoom to fit | `camera.ts:53` `zoomToFit` | `⌘1`; `view-menu.tsx:37` | — | **[API]** |
| Zoom to selection | `camera.ts:61` `zoomToSelection` | `⌘2`; `view-menu.tsx:43` | — | **[API]** |
| Pan | Hand tool, or Space-hold (`shortcuts.ts:263` `takeHandTool`, delay `SPACE_HAND_DELAY=200` `:242`); camera controller `ES/engine/camera-controller.tsx` | drag | — | **[UI-ONLY]** — **no `panBy(dx,dy)` function exists** |
| Workspace | `ES/context/layout.tsx:77` `setWorkspace` | registered cmds `workspace.storyboard/edit/motion` (`voice-bar.tsx:151-166`) | CLOSED `storyboard \| edit \| motion` (`layout.tsx:34`) | **[API]** via layout context (needs the Solid provider) |
| Toggle assets panel | `layout.tsx:68` `toggleLeft` | cmd `panel.assets` (`voice-bar.tsx:166`) | — | **[API]** |
| Toggle inspector | `layout.tsx:69` `toggleInspector` | cmd `panel.inspector` (`voice-bar.tsx:171`) | — | **[API]** |
| Toggle timeline | `layout.tsx:87` `toggleTimeline` | cmd `panel.timeline` (`voice-bar.tsx:176`); `view-menu.tsx:56` | — | **[API]** |
| Toggle mixer | `layout.tsx:88` `toggleMixer` | soundboard | — | **[API]** — **no command id** |
| Inspector tab | `layout.tsx:71-75` `setInspectorTab` | tab buttons `inspector.tsx:140` | CLOSED `design\|motion\|history` | **[API]** — only reachable by command via `panel.history` |
| Hide the interface | `layout.tsx:86` `toggleUI` | cmd `view.hide-interface`; `view-menu.tsx:53` | — | **[API]** |
| Theme | `layout.tsx:93` `toggleEditorTheme` | cmd `view.theme` | CLOSED `noir \| frost` (`layout.tsx:33`) — note the command label says "Noir/Glass" | **[API]** toggle only, **no set-to-a-specific-theme** |
| Timeline zoom / detail | see C.1 | | | |
| Reveal an element in the source | `ES/components/timeline/layers/node.tsx:196` `handleRevealInCode`; `ES/components/shell/selection-actions.tsx:45` | layer context menu "Reveal in code"; inspector "Code ↗" | `id` (source stamp) | **[UI-ONLY]** (IPC `PROJECTS_SOURCE_LOCATE`) |

---

# I. PROJECT-LEVEL

### Export
- `exportScene(scene, config)` — `ES/context/export.tsx:45` (context value declared `:28`). **[UI-ONLY]** (a Solid context method, needs the provider).
- `exportCurrentFrame()` — `ES/context/export.tsx:169`, writes a PNG of the current frame. Trigger: `⇧⌘E` (`:194` `handleShortcut`), File menu `file-menu.tsx:217`.
- `exportActiveScene()` — `ES/context/export.tsx:181`; `⌘E`.
- Command `export.video` registered at `ES/components/shell/voice-bar.tsx:199` — uses `config()?.exportOf(scene) ?? getDefaultExportTemplate()`.
- Command `export.settings` registered at `ES/components/shell/command-bar.tsx:42`; `export.library` at `voice-bar.tsx:207` (navigates to `/?view=exports`).
- **Templates** — `ES/components/sidebar-right/inspector/export-templates.ts:36`, 9 presets in 3 groups:
  - Standard: `h264-mp4-720p` "HD" (7 Mbps), `h264-mp4-1080p` "Full HD" (12 Mbps, **default** `:126`), `h264-mp4-1440p` "2k Quad HD" (24 Mbps), `h264-mp4-2160p` "4K Ultra HD" (64 Mbps) — all mp4/avc/aac.
  - Social Media: `youtube-1080p`, `youtube-4k`, `instagram-1080p`, `tiktok-1080p`.
  - Web embedding: `web-embedding-720p` (webm/vp9/opus, 3 Mbps).
- **Per-field parameters** (`export-templates.ts:22-27`, panel `export.tsx`):
  - `template:` CLOSED (the 9 ids) — `export.tsx:113`.
  - `video.resolution:` CLOSED `720 | 1080 | 1440 | 2160` — `export.tsx:299`.
  - `video.bitrate:` NUM (UI in Mbps ×1e6) — `export.tsx:315`.
  - `video.codec:` CLOSED `avc | hevc | vp9 | av1 | vp8` — `export.tsx:325`.
  - `format:` CLOSED `mp4 | webm | ogg | mov` — `export.tsx:342`; MIME map `export-templates.ts:29`.
  - `audio.codec:` CLOSED `aac | opus` — `export.tsx:400`.
  - `audio.sampleRate:` CLOSED `44100 | 48000 | 96000` — `export.tsx:417`.
  - `FRAME_RATE_OPTIONS` CLOSED `24, 25, 29.97, 30, 48, 50, 59.94, 60` — `export-templates.ts:25`.
- Persistence: `ProjectConfig.setExport(scene, settings)` `ES/engine/project-config.ts:186`, read back `exportOf` `:176`; stored in `package.json` (`PROJECT_CONFIG_FILE :35`).
- **[RPC]** `export` route `api.tsx:382` (`ES/context/agent-api/export.ts` `handleExport`), progress `exportProgress` `:383`.
- Export range = the scene's `workarea` (see C), by design (`ES/engine/transport.ts:8-13`).

### History / undo
- `EditHistory` — `ES/engine/history.ts:134`; accessor `getEditHistory(world)` `:696`.
  Public: `canUndo() :164`, `canRedo() :170`, `serialize() :183`, `restore(value) :196`, `unrecorded(change) :227`, `follow(ids) :246`, `reset() :255`, `beginGesture() :268`, `endGesture(): boolean :274`, `undo() :284`, `redo() :295`.
- Commands: `undoEdit` `shortcuts.ts:92`, `redoEdit` `:96`; `⌘Z` / `⇧⌘Z`. Edit menu `edit-menu.tsx:36`,`:40`. App context menu `ES/components/app-context-menu.tsx:66`,`:70`.
- **[RPC]** `canvas.undo` / `canvas.redo` (`api.tsx:378-379` → `canvas.ts:390`,`:396`).
- Gestures: `beginGesture`/`endGesture` bracket multi-edit operations so they undo as one (`canvas.ts:339`,`:377`; `command-resolver.ts:256`,`:268`).

### Version history / revisions / trash
`ES/components/sidebar-right/inspector/version-history.tsx:38` — lists via `listRevisions` / `listTrash` and restores via `restoreRevision(dir, id)` `:57` / `restoreTrash(dir, id)` `:75` (all from `ES/projects/history.ts`). Command `panel.history` (`voice-bar.tsx:181`) only opens the tab. **[UI-ONLY]** for restore.
Scene deletes are copied to project trash first: `ES/engine/delete-guard.tsx:46` `requestDelete(world, entities)`; agent path does the same without a dialog (`canvas.ts:245-256`, `putTrash`).

### Variables (`@inspect`)
`DocumentEditor.editVariable(file, name, value)` `editor.ts:384` — **[API]**, **[RPC]** `canvas.setVariable` (`api.tsx:368` → `canvas.ts:181`). Wire type `CanvasVariableRequest = {file, name, value: string|number|boolean}` (`cli-channels.ts:473`). UI: `variables.tsx:67` `commit`, with typed controls for `number | color | font | text | boolean | select` (`:71-107`). Shown only when nothing is selected (`inspector.tsx:176`).

### Skills / skill deck
- `installSkill(world, scene, skill|null)` — `ES/engine/skill-deck.tsx:53`. Writes `scene.skill` (or `false`) and maintains a `<marker time={0} name="…">` sentinel (`:69-73`). **[API]**.
- `openSkillDeck(scene)` `:29`, `closeSkillDeck()` `:34`, `toggleSkillDeck(scene)` `:38`, `sceneSkillName(scene)` `:44`.
- Trigger: skill chip on a scene header (`ES/engine/input/interactions.ts:330` `handleSkillInteraction`), inspector `scene-skill.tsx:24`. Card catalogue `ES/lib/skills.ts` (`skillCards`, `findSkill`, `refreshSkills`, `revealSkill`, `missingKeys`).
- **No command id** for opening the deck or installing a skill.

### Assets
- Library panel `ES/components/sidebar-left/assets.tsx`; per-asset context menu `ES/components/sidebar-left/asset-item.tsx:157-174`: **Insert to timeline** (`:102`), **Rename** (`:75` `library.rename`), **Replace media** (`:96` → `replaceAssetSource` `asset-actions.ts:86`), **Save as** (`:101` → `saveAssetAs` `asset-actions.ts:23`), **Delete** (`:58`).
- Folder context menu `ES/components/sidebar-left/folder-item.tsx:171-175`: Open, Rename (`:97`), Delete (`:118`). Drag-drop into folders `:73-95`.
- File menu `ES/components/sidebar-left/project-menu/file-menu.tsx`: Import from computer `:31`, Download all `:78`, Remove unused `:137`, Export scene `:188`, Export current frame `:217`, Export a named scene `:235`.
- All asset operations are **[UI-ONLY]**.

### Project rename
`ES/components/shell/command-bar.tsx:47` `commitName` → `project.rename(name)`. **[UI-ONLY]**, no command id.

### Open in coding agent
`registerCommand({id:'agent.open', keys:['o','mod','shift']})` at `ES/components/posterract-code-panel.tsx:146`.

### Other RPC routes worth knowing
`open` (`api.tsx:299`), `context` (`:310`), `validate` (`:311`), `source.read/write/edit` (`:327/:336/:344`), `geometry` (`:351`), `inspect` (`:353`), `look`/`show` (`:355/:356`), `capture` (`:381`), `check` (`:384`), `logs` (`:385`), `screenshot` (`:386`), `media.probe/frame/filmstrip/waveform/extract/transcribe` (`:388-393`).
Every document-changing route is wrapped by `edit()` (`api.tsx:272`) which runs `requireUntouched` (optimistic-concurrency on `expectedRevisionId`, `:246`) and waits for the source write (`written()` `:194`).

---

# J. CONTEXT MENUS

### Timeline layer row — `ES/components/timeline/layers/node.tsx:439-475`
| Item | Handler | Notes |
|---|---|---|
| Mute / Unmute | `:94` `toggleMuted` | prop `muted` |
| Solo / Unsolo | `:115` `toggleSoloed` | **trait only, not persisted** |
| Hide / Unhide | `:99` `toggleHidden` | prop `hidden` |
| Bring to front `]` | `:230` `handleReorder('front')` | its own `reparent`, distinct from `restackSelection` |
| Send to back `[` | `:230` `handleReorder('back')` | |
| **Reveal in code** | `:196` `handleRevealInCode` | **no shortcut, no command** |
| **Bake to keyframes ▸** | `:172` `handleBake(property)`; menu `:455-471`; `BAKEABLE` at `:62` = `x, y, rotation, scale, opacity, width, height` | **no shortcut; RPC exists (`canvas.bake`)** |
| Remove | `:222` `handleRemove` → `requestDelete` | |

Also on the row (buttons, no menu): Lock/Unlock `:225`, expand chevron `:104`, inline rename (double-click) `:256`, row-height drag `:160`.

### App-wide context menu — `ES/components/app-context-menu.tsx:60-100`
Undo ⌘Z `:66` · Redo ⇧⌘Z `:70` · Cut ⌘X `:75` · Copy ⌘C `:79` · Paste ⌘V `:83` · Select All ⌘A `:87` · Fullscreen F11 `:92` · Reload ⌘R `:97`.

### Inspector row context menus ("reset to default")
`time.tsx`, `appearance.tsx`, `effects.tsx`, `fill-row.tsx`, `strokes.tsx`, `shadows.tsx`, `gradient-picker.tsx`, and every `transform/*-row.tsx` (`skew-row`, `anchor-row`, `offset-row`, `rotate-row` `:61+`, `scale-row`) wrap their control in a `ContextMenu` whose item resets the prop. **[UI-ONLY]** and undiscoverable by name.

### Asset / folder / dashboard menus
See I (assets); dashboard `ES/components/dashboard/projects-view.tsx`, `exports-view.tsx`.

### No canvas context menu
There is **no right-click menu on the canvas** other than the app-wide one.

---

# K. The `COMMANDS` registry (voice bar / shortcut sheet)

### K.1 From `ES/engine/input/shortcuts.ts`

`COMMANDS` is built at `shortcuts.ts:571` from `PRESSED_SHORTCUTS` (`:479`) + `LISTED_ONLY` (`:561`), de-duplicated by id, keeping table order. Shape: `{keys, action, id, label, group, aliases?, when?, done?}` (`:71-87`); groups are `Transport | Range | Editing | Canvas | Timeline | Export | Agent` (`:69`).

| id | label | keys | when | done |
|---|---|---|---|---|
| `edit.undo` | Undo — survives a reload | ⌘Z | — | Undone |
| `edit.redo` | Redo | ⇧⌘Z | — | Redone |
| `edit.delete` | Delete — a scene with content asks first | ⌫ | selection | Deleted |
| `edit.duplicate` | Duplicate | ⌘D | selection | Duplicated |
| `edit.group` | Group | ⌘G | selection | Grouped |
| `edit.ungroup` | Ungroup | ⇧⌘G | selection | Ungrouped |
| `edit.wrap-scene` | Wrap in a scene | ⌘Enter | selection | Wrapped in a scene |
| `edit.wrap-sequence` | Wrap in a sequence | ⌘⌥Enter | selection | Wrapped in a sequence |
| `edit.unwrap-sequence` | Unwrap the sequence | ⌘⌥⇧Enter | selection | Unwrapped |
| `edit.split` | Split at the playhead | ⌘B | scene | Split at the playhead |
| `edit.copy` | Copy | ⌘C | selection | Copied |
| `edit.paste` | Paste | ⌘V | — | Pasted |
| `edit.cut` | Cut to the clipboard | ⌘X | selection | Cut to the clipboard |
| `edit.hide` | Hide or show the selection | ⇧⌘H | selection | — |
| `edit.select-all` | Select all | ⌘A | — | — |
| `canvas.zoom-in` | Zoom in | ⌘= | — | — |
| `canvas.zoom-out` | Zoom out | ⌘- | — | — |
| `canvas.actual-size` | Actual size | ⌘0 | — | — |
| `canvas.zoom-fit` | Zoom to fit | ⌘1 | — | — |
| `canvas.zoom-selection` | Zoom to selection | ⌘2 | selection | — |
| `canvas.move-tool` | Move tool | V | — | — |
| `canvas.hand-tool` | Hand tool | H | — | — |
| `canvas.frame-tool` | Frame | F | — | — |
| `canvas.text-tool` | Text | T | — | — |
| `canvas.component-tool` | Component — draw a shape | R | — | — |
| `transport.frame-back` | Back one frame | A | — | — |
| `transport.frame-forward` | Forward one frame | D | — | — |
| `transport.second-forward` | Forward one second | W | — | — |
| `transport.second-back` | Back one second | S | — | — |
| `edit.bring-front` | Bring to front | ] | selection | Brought to front |
| `edit.send-back` | Send to back | [ | selection | Sent to back |
| `edit.select-parents` | Select the parent | \ | selection | — |
| `edit.select-children` | Select the children | Enter | selection | — |
| `edit.deselect` | Deselect | Esc | — | — |
| `canvas.nudge-left/right/up/down` | Nudge … | ←/→/↑/↓ | selection | — |
| `canvas.nudge-*-far` | Nudge … ten pixels | ⇧ + arrows | selection | — |
| `transport.start` | Go to the start, or the in point | Home | — | — |
| `transport.end` | Go to the end, or the out point | End | — | — |
| `transport.previous-cut` | Previous cut | ⌥↑ | — | — |
| `transport.next-cut` | Next cut | ⌥↓ | — | — |
| `transport.shuttle-back` | Shuttle back — press again for 2× and 4× | J | — | — |
| `transport.pause-shuttle` | Pause the shuttle | K | — | — |
| `voice.type` | Type a command | ⌘K | — | — |
| `voice.talk` | Talk to the editor | Q (or \` / G, `TALK_KEYS` `:191`) | — | — |
| `transport.shuttle-forward` | Shuttle forward — press again for 2× and 4× | L | — | — |
| `range.in` | Mark in — sets the work area an export renders | I | scene | Marked in |
| `range.out` | Mark out | O | scene | Marked out |
| `range.clear` | Clear the range | ⌥X | scene | Cleared the range |
| `edit.snapping` | Snapping on or off — hold ⌘ while dragging to invert | N | — | — |
| `range.marker` | Marker at the playhead — press again to remove it | M | scene | — |
| `edit.nudge-earlier` / `-later` | Nudge the selection one frame earlier/later | ⌥←/→ | selection | — |
| `edit.nudge-earlier-far` / `-later-far` | Nudge ten frames earlier/later | ⇧⌥←/→ | selection | — |
| `timeline.zoom-in` / `-out` | Zoom the timeline in/out | ⌥= / ⌥- | — | — |
| `timeline.fit` | Fit the whole video | ⇧Z | — | — |
| `timeline.zoom-selection` | Zoom the timeline to the selection | ⌥Z | selection | — |
| `edit.ripple-delete` | Ripple delete — closes the gap | ⇧⌫ | selection | Ripple deleted |
| `transport.play` (LISTED_ONLY `:562`) | Play / pause | Space | — | — |

Unnamed duplicate bindings (no id, not commands): `delete`, `⌘+`, `⌥+`, `⇧delete`, Space press/lift (`:524`, `:583`), talk-key lift (`:584`).

### K.2 Registered from the UI

`registerCommand` — `ES/engine/voice.tsx:201`. `barCommands()` `ES/engine/voice.tsx:149` = `COMMANDS` + `AGAIN_COMMAND` + registered, minus any id starting `voice.`.

| id | label | group | keys | when | registered at |
|---|---|---|---|---|---|
| `edit.again` | Do that again | Editing | — | — | `ES/engine/voice.tsx:135` (`AGAIN_COMMAND`) |
| `workspace.storyboard` | Storyboard workspace | Canvas | — | — | `voice-bar.tsx:151` |
| `workspace.edit` | Edit workspace | Canvas | — | — | `voice-bar.tsx:156` |
| `workspace.motion` | Motion workspace | Canvas | — | — | `voice-bar.tsx:161` |
| `panel.assets` | Show or hide assets | Canvas | — | — | `voice-bar.tsx:166` |
| `panel.inspector` | Show or hide the inspector | Canvas | — | — | `voice-bar.tsx:171` |
| `panel.timeline` | Expand or collapse the timeline | Timeline | — | — | `voice-bar.tsx:176` |
| `panel.history` | Version history | Editing | — | — | `voice-bar.tsx:181` |
| `view.theme` | Switch between Noir and Glass | Canvas | — | — | `voice-bar.tsx:189` |
| `view.hide-interface` | Hide the interface | Canvas | — | — | `voice-bar.tsx:194` |
| `export.video` | Export the video | Export | ⌘E | scene | `voice-bar.tsx:199` |
| `export.library` | Open the exports library | Export | — | — | `voice-bar.tsx:207` |
| `ai.generate` | Open AI Generate | Agent | — | — | `voice-bar.tsx:212` |
| `export.settings` | Export settings | Export | — | scene | `ES/components/shell/command-bar.tsx:42` |
| `agent.open` | Open this project in your agent | Agent | ⇧⌘O | — | `ES/components/posterract-code-panel.tsx:146` |

Every one of these has a plain-English description in `COMMAND_DESCRIPTIONS` (`ES/context/agent-api/command-descriptions.ts:17-97`) — **80 entries**, and that table is what the model actually chooses between.

---

# L. What `command-resolver.ts` sends to the model

Flow: `resolveCommand` (`ES/context/agent-api/command-resolver.ts:165`) → `situationOf` (`:114`) builds the canvas state → `buildQuestions` (`ES/context/agent-api/command-reading.ts:376`) → one decisions request → optionally `memberQuestions` (`:461`) → `readAnswers` (`:1038`).

### L.1 The `action` question (`command-reading.ts:378`)
Options = `actionOptions()` (`:351`): every command id from `barCommands()` that passes its `when` gate, described by `COMMAND_DESCRIPTIONS`, **plus** the seven `ACTION_DESCRIPTIONS` (`command-descriptions.ts:100-108`):
- `edit-properties`
- `change-text`
- `add-animation`
- `add-effect`
- `remove-animation`
- `needs-writing` (→ leaves an `@agent …` marker)
- `none`

### L.2 Every slot / question id built per request (`buildQuestions`)

| id | type | options |
|---|---|---|
| `action` | choice | commands + 7 actions above |
| `target` | choice | each element id (`describeElement` `:293`), plus `selection` (when something is selected) and `none` (`targetOptions :364`) |
| `target_all` | noul | yes/no — does the command mean several elements |
| `said_<prop>` × 31 | noul | one per `SPOKEN_PROPS` (`:67`): `place, x, y, width, height, scale, rotation, opacity, color, cornerRadius, blendMode, hidden, fontSize, fontFamily, fontWeight, fontStyle, letterSpacing, leading, textAlign, textCase, textDecoration, objectFit, volume, muted, playbackRate, start, end, name, preset, verticalAlign` |
| `value_<prop>` × 10 | choice | for `CHOICE_PROPS` (`:75`): `place, blendMode, fontWeight, fontStyle, textAlign, textCase, textDecoration, objectFit, preset, verticalAlign` — values from `VALUE_DESCRIPTIONS` |
| `value_hidden` | noul | hide vs show |
| `value_muted` | noul | mute vs unmute |
| `color_name` | choice | 13 colors + `unstated` (`COLOR_NAMES` `command-descriptions.ts:288`) |
| `value_fontFamily` | choice | up to 60 loaded font families + `unstated` (only when fonts exist) |
| `said_animation` | noul | is an entrance/exit asked for |
| `anim_type` | choice | the 14 animation types |
| `anim_phase` | choice | `in \| out` |
| `anim_easing` | choice | the 8 easings + `unstated` |
| `effect_type` | choice | the 8 filters |
| `direction` | choice | `left, right, up, down, none` |
| `size` | choice | `bigger, smaller, none` |
| `amount` | score | `AMOUNT_LEVELS = ["a little","noticeably","a lot"]` |
| `number_for` | choice (only if the command contains a number) | `x, y, width, height, scale, rotation, opacity, cornerRadius, fontSize, letterSpacing, leading, volume, playbackRate, start, end, animationDuration, effectValue, none` (`NUMBER_DESCRIPTIONS` `:81`) |
| `text_start` | choice (only when no quoted text and ≥3 words) | word index 1..n, or `none` |
| `is_<index>` | noul, second request | one per bounded element (`memberQuestions :461`) |

Supporting constants: `THRESHOLDS` `:42` (apply 0.8, confirm 0.5, said 0.5, targetAll 0.6, member 0.5, nonsense 0.8); `STEPS` `:58` (size ×1.15/1.3/1.6; move 5 %/10 %/20 % of the scene's shorter side); `ELEMENT_LIMIT = 120` `:61`; `DESTRUCTIVE = {edit.delete, edit.ripple-delete}` `:64`; `EFFECT_DEFAULTS` `:103`.

Apply path: `applyReading` (`command-resolver.ts:222`) → `canvasApply` for edits (`:242`), or an explicit gesture for animation removals (`:254-269`), or `addMarkerAtPlayhead` for notes (`:231`).

### L.3 Editor capabilities with NO corresponding `action` or slot

**No action option exists for** (a command naming these can only land on `needs-writing`/`none`, or be misrouted):

- **Creating anything.** There is no `create-element`, `add-text`, `add-shape`, `add-image`, `add-captions`, `add-marker` action. The only creative outputs are `add-animation` (an `<animation>` child) and `add-effect` (an `<effect>` child). "Add a title", "put a rectangle here", "add captions" cannot be expressed.
- **Inserting an asset** (`insertAsset`, `insertMediaAsScenes`, `insertSounds`, `insertAssetAtPlayhead`) — no action, no ASSET slot type at all. The resolver has no concept of an asset reference.
- **AI generation with parameters** — `ai.generate` only opens the panel; no `prompt`, `aspectRatio`, `durationSec`, `quality`, `voiceId` slots.
- **Align / distribute** — `alignSelection` and `distributeSelection` have no command ids, so they are not in `actionOptions` and have no slot. "Align these left" will most likely be read as `textAlign` (the descriptions warn about this at `command-descriptions.ts:130` and `command-reading.ts:772-775`).
- **Trim / slip / slide / move a clip to an absolute time.** `start` and `end` are `said_*` props, and `here` maps to the playhead (`command-reading.ts:693`), but there is no trim, slip, slide or "move it to 0:12" slot.
- **Seek to an absolute time** — only relative transport commands exist. "Go to 5 seconds" has no expression.
- **Keyframes** — no add/remove/move/bake action; `bake` exists only as RPC and a context menu.
- **Flip, skew, anchor, constraints, clipsContent** — no `said_*` props.
- **Stroke, shadow, gradient, fill stacking, corner-radius-per-corner, `textBaseline`, `inset`, `offsetX/offsetY`, `scaleX/scaleY`, `keepAspectRatio`, `locked`, `expanded`, `clipHeight`, `syncTo`, `upscale`, `removeBackground`, `addAudio`, `frameRate`, `seed`, `colors`, `workarea`, `stagger`, `skill`** — none are in `SPOKEN_PROPS`, so no `said_*` question is asked. `locked` in particular has a UI toggle and no voice path.
- **Transitions** — no action and no `transition` prop slot.
- **Cues / transcription / subtitle export** — `preset` and `verticalAlign` are spoken props, but nothing can transcribe, add a cue, edit a cue, or export SRT/VTT.
- **Solo** — no prop, no action (it is a non-persisted trait).
- **Select-all-of-a-kind, select parent/children by name** — `edit.select-parents` / `edit.select-children` are commands, so they *are* offered; but "select every text" relies on `target_all` + a command, which only works for commands, not for a free-standing selection intent.
- **Shape conversion** (`changeShape`) — no command, no action.
- **Project-level**: rename project, restore a revision, restore trash, import assets, rename/delete an asset, replace media, set an export template/codec/resolution, `setVariable` — none have actions or slots. `export.video` exists but takes no parameters.
- **Workspace/panel/theme** — present as commands, but `view.theme` is a toggle only; there is no "switch to Noir" vs "switch to Glass".
- **Timeline detail level**, **mixer**, **inspector tab (design/motion)**, **camera pan** — no commands at all.

---

# Capabilities with no programmatic entry point

These exist only inside a UI event handler or a pointer-drag and would need extracting before an intent executor can call them:

1. **Draw-to-create** (scene / shape / text with the tool defaults) — `ES/components/canvas/draw-overlay.tsx:164` `handlePointerUp`. All sizing, parenting, naming and font-size derivation is inline.
2. **Canvas move / resize / rotate gestures** — `ES/engine/input/interactions.ts:718`, `:348`, `:645`. `editTransform` (`:129`) is callable, but "resize this to 400×300 about its centre with the ratio locked" has no function.
3. **Group resize behaviour** — `resizeNode :560` and `keepGroupPlaced :614` are drag-internals.
4. **Drop-into-scene reparenting with the 250 ms dwell** — `interactions.ts:922` `reparentTo` (private).
5. **Canvas marquee selection** — `interactions.ts:223-250`.
6. **Drill-in (double-click)** — `interactions.ts:200`, `:723`.
7. **Canvas / library drag-drop routing** — `ES/components/canvas/canvas.tsx:33`.
8. **Layer-tree drag-reorder** — `ES/components/timeline/layers/context.tsx:224` `performDrop` (private to the provider).
9. **Layer row height** — `ES/components/timeline/layers/node.tsx:143`.
10. **Timeline clip drag / trim as a whole gesture** — `ES/engine/timeline/drag.ts` + `render/clip.ts`. (`moveEntityTo`, `trimIn/Out`, `slipEntity`, `slideEntity` are callable; the snapping and multi-clip coordination are not.)
11. **Playhead scrub, work-area drag, keyframe drag** — `render/ruler.ts:54`, `render/workarea.ts:61/91/103`, `render/keyframes.ts:167`.
12. **Solo** — `node.tsx:115`, trait-only and exclusive.
13. **Flip, skew, anchor, constraints, clipsContent** — `rotate-row.tsx:50`, `interactions.ts:597`, `anchor-row.tsx`, `constraints-row.tsx:35`, `layout.tsx:59`. All trait-only, none persisted to source.
14. **Caption workflows** — unpack `cue-editor.tsx:63`, transcribe-to-cues `:~160`, subtitle export `:80`.
15. **Scene-format presets** — `scene-template.tsx:20`.
16. **Fill-kind swap** — `fill-picker.tsx:113` `replaceFill`, plus every default-value decision in the fill/stroke/shadow/effect/animation/mask add handlers.
17. **Fill/stroke/shadow/effect reorder** — the swap-by-paired-`reparent` trick at `fills.tsx:146`, `strokes.tsx:84`, `shadows.tsx:96`, `effects.tsx:84`.
18. **Export** — `ES/context/export.tsx:45` is a Solid context method; `exportCurrentFrame :169`, `exportActiveScene :181` likewise.
19. **Export settings persistence** — `ProjectConfig.setExport` `ES/engine/project-config.ts:186` is a class method reached only from the panel.
20. **Version history restore, trash restore** — `version-history.tsx:57`, `:75`.
21. **All asset library operations** — import, rename, delete, replace, save-as, folder CRUD (`asset-item.tsx`, `folder-item.tsx`, `file-menu.tsx`).
22. **Project rename** — `command-bar.tsx:47`.
23. **Reveal in code** — `node.tsx:196`, `selection-actions.tsx:45`.
24. **Layout / workspace / theme / panel toggles** — `ES/context/layout.tsx` (context methods, reachable only inside the provider; the registered commands are the workaround).
25. **Inline rename on canvas and in the layer list** — `ES/engine/hud/name-input.ts` via `interactions.ts:318`; `node.tsx:256`.
26. **Camera pan** — no function at all; only the Hand tool and the camera controller.
27. **AI generate panel** — `openGeneratePanel` exists (`generate-panel.tsx:119`) but "generate an image of X at 9:16" has no headless path in the editor (the RPC routes `ai.image/video/voice` exist for agents, but nothing wires a command to them).

---

# Biggest gaps between what the editor can do and what the command bar can express

1. **Creation is entirely missing from the command surface.** The editor can author 43 element kinds; the bar can author exactly two (`<animation>`, `<effect>`) and neither is a first-class thing a person would say they're "adding". "Add a title", "add a rectangle", "add captions", "drop a marker at 3 seconds" (only `range.marker` at the playhead), "put this image in" — none can be expressed. `canvasCreate` / `canvasApply{op:"create"}` already exist as executors; the resolver simply has no `create-element` action with a `tag` slot.

2. **No asset or time slot types.** The resolver's literal extractor (`command-reading.ts:235` `findLiterals`) handles numbers, quotes, hex colors and the word "here". It cannot resolve an asset by name, nor a timecode ("0:12", "at two seconds in"). `start`/`end` only accept a plain number or `here`. This blocks every insert-asset, seek-to-time, trim-to-time and marker-at-time intent.

3. **Timeline editing is nearly absent.** Split and ripple-delete are commands; nudge-in-time is a command. But trim, slip, slide, move-a-clip-to-a-time, set-duration, change-speed-to-2× (only `playbackRate` as a bare number), and every work-area operation beyond `range.in/out/clear` at the playhead have no expression. This is the single largest functional area with plain functions ready (`ES/engine/timing.ts`) but no intent.

4. **Align/distribute is implemented, exposed in the inspector, and invisible to the bar.** `alignSelection` / `distributeSelection` (`ES/engine/align.ts:105`, `:139`) take a clean closed-set argument and have no command id and no shortcut. Worse, "align left" currently competes with `textAlign` in the prop questions.

5. **Keyframes and baking.** `toggleKeyframe`, `writeKeyframe`, `removeKeyframeTrack` (`ES/engine/keyframes.tsx`) and `bakeToKeyframes` (`ES/engine/bake.tsx:85`) are clean `(world, editor, target, property)` functions with a 25-value closed property set and an RPC route. Nothing in the bar can reach them. "Keyframe the opacity here", "bake the rotation", "remove the x track" are all unsayable.

6. **The spoken-prop set covers ~30 of roughly 180 distinct props.** Notably missing and user-visible: stroke and shadow (whole panels), gradient stops, per-corner radius, `inset`, `offsetX/Y`, `scaleX/scaleY`, `textBaseline`, `keepAspectRatio`, `locked`, `transition`, `workarea`, `stagger`, `skill`, `syncTo`, `upscale`, `removeBackground`, `seed`, caption `colors`.

7. **Non-persisted traits are unreachable and also unsafe to expose.** Flip, skew, anchor, constraints, `clipsContent`, and solo all live only in traits with no JSX spelling (explicitly noted at `ES/components/sidebar-right/inspector/transform/rotate-row.tsx:30` and `ES/engine/input/interactions.ts:597`). Any intent for these will silently lose its effect on recompile unless the vocabulary gains props first.

8. **Project-level actions are commands without parameters.** `export.video` runs with whatever template is configured; there is no way to say "export as 4K" or "export to TikTok". Similarly `ai.generate` only opens a panel — the parameterised RPCs (`ai.image/video/voice`) are agent-only. `canvas.setVariable` exists as an RPC and has no voice path at all.

9. **Toggles where a person would state a value.** `view.theme`, `edit.hide`, `edit.snapping`, mute, lock, solo are all flip-flops. "Turn snapping off", "switch to Noir", "lock this layer" cannot be made idempotent. (`value_hidden` and `value_muted` exist as prop questions and *do* carry a direction — those two are the model to follow.)

10. **Whole subsystems are invisible.** Captions/transcription (beyond preset and vertical alignment), version history and trash restore, the asset library, project rename, shape conversion, transitions, mask creation, the skill deck, timeline detail, the mixer, camera pan, and the inspector's design/motion tabs.

11. **Structural asymmetry**: `edit.group`/`ungroup`/`wrap-scene`/`wrap-sequence`/`unwrap-sequence` are commands, but `reparent` ("move this into that scene", "put this inside the group") is not — despite `canvasMove` (`ES/context/agent-api/canvas.ts:258`) being a ready executor with exactly the right shape.
