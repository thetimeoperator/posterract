# Posterract: editor, agent, animation, and publishing review

Date: September 5, 2026. Status: researched proposal; product implementation is not changed by this review.

## 1. The decision I would make

**Make Posterract the editor where a creator and their own agent can work on the same editable video, understand every change, and carry the finished result directly into publishing.**

The opportunity is larger than generating attractive clips. The valuable experience is: ask for a change, see exactly what changed, adjust it visually, undo it, make platform variants, and schedule the right version through the right account.

Posterract already has much of the underlying machinery. The next investment should concentrate on five improvements, in this order:

1. **Make the editor easier to read and operate.** Improve preview sizing, timeline visibility, inspector organization, control labels, and the placement of Export. Keep the black/mint visual identity and floating panels, but make working space predictable.
2. **Finish the promise that animation remains editable.** Promote the existing timeline detail modes; fix gaps; give component instances durable identities; distinguish native keyframes, procedural motion, and embedded assets.
3. **Make the agent a visible collaborator.** Add selected-context requests, reliable completion receipts, project revision checks, before/after previews, and named undoable changes.
4. **Create a small library of excellent motion components.** Package composition structure, exposed controls, timing rules, and quality checks together. Improve the authoring experience before expanding the renderer vocabulary.
5. **Connect creation to delivery with version certainty.** Make it obvious which render, source revision, platform variant, account, and publication status belong together.

**Yes, you can build a custom HyperFrames-like experience entirely inside Posterract.** I recommend extending Posterract's current composition system into that experience. A wholesale replacement with another editor would duplicate source editing, timing, selection, history, media handling, and export responsibilities that already exist.

The important product contract is: **every visible object can be found; every supported animated property can be inspected; every change can be understood and recovered.** A timeline row alone does not establish full editability.

## 2. What this review actually inspected

The review combined source inspection, the installed macOS app, upstream source, official HyperFrames documentation, type checks, existing focused tests, and two isolated reproductions.

| Evidence | Scope |
| --- | --- |
| Local source | Current working tree based on `3cbf5e9f1600a7197741b472608369efd29f4862`, including pre-existing modified and untracked editor/skills work |
| Installed app | Opened the existing project; inspected the canvas, collapsed and expanded timeline, history, agent launcher, calendar, and empty composer |
| Lottie upstream | `diffusionstudio/lottie`, commit `3c72912fad543897f90045ed4d355813837927fc`, dated July 25, 2026 |
| Editor upstream | `diffusionstudio/editor`, commit `d4faad7155cfc450c439fe0bc3745a90d8aa7593`, dated September 3, 2026 |
| HyperFrames | Official repository and current official canvas, timeline, and animation documentation |
| Checks | Editor, desktop, and web TypeScript checks passed; 22 runtime tests and 3 orchestrator tests passed |
| Reproductions | Preset-only sequence animation omitted from Animation view; fixed-millisecond calendar arithmetic crosses DST incorrectly |

Windows and Linux installers, GPU/codec behavior on those systems, production publishing, production health, and end-to-end export fidelity were **not** validated in this review. Three-platform availability comes from your description; packaging code and Windows/Linux CI are present. The installed application was not mapped to an exact build commit, so observations of its UI are distinguished from findings in the current source.

No posts were submitted, no new agent permissions were granted, and no deployment, commit, or push was performed. Earlier planning documents were treated as historical context; implementation was checked directly. Some of their proposed work has since been implemented.

## 3. What you already have—and should build on

| Area | Evidence in the current source | Implication |
| --- | --- | --- |
| Code/visual round trip | TSX source stamping, semantic edits, source writer, file watcher, compilation, runtime mounting | Preserve this as the core document model |
| Canvas | Multiple scenes, transforms, selection, grouping, alignment, shapes, text, media | Improve targeting, focus, and discoverability |
| Timeline | Clips, keyframes, Animation/Everything detail levels, component headings, code-driven property rows | The requested comprehensive timeline is partly built already |
| Manual editing | Split, trim, ripple delete, timeline zoom, snapping toggle, markers, media replacement | Expose and polish existing operations before rebuilding them |
| Animation | 14 preset types; keyframe tracks; easing including spring descriptors; stagger; vector trim/morph; diagram progress | The main gap is authoring and organization, not absence of animation |
| Transitions | Five authored transition types | Expand after better timing controls and preview are in place |
| Captions | Editable cues, transcription path, styling, SRT/WebVTT support | Develop a transcript workspace and better caption timing workflows |
| Audio | Mixer, volume animation, ducking implementation and tests | Add voice/music roles, usable envelopes, and clearer monitoring |
| Procedural motion | `useTicker()` plus offline sampling into keyframes | Keep procedural originals and make the relationship understandable |
| Lottie | Skottie playback, source-backed slots, inspector and timeline integration | Strengthen compatibility and controls; it is already an integration |
| Agent access | MCP tools for source, canvas edits, geometry, capture, validation, media, generation, export | Add a coherent operation/session layer over these tools |
| Agent onboarding | Discovery/opening of external coding clients; project guidance; recipes | Connection works as a foundation; distinguish setup, connection, and actual task execution |
| Recovery | Edit history, undo cache, source snapshots, restore UI, project trash | Add named project checkpoints and visual comparisons |
| Skills | Bundled/user/project discovery, scene assignment, card UI, marker and agent context | Turn skill selection into a useful guided workflow |
| Delivery | Local exports library, explicit upload to cloud composer, provenance fields | Build a clear version and platform-variant handoff |
| Scheduling | Month/week calendar, drag reschedule, per-platform captions, account sets, Temporal jobs | Improve readiness, time semantics, and status presentation |
| Analytics | Account/post analytics paths and periodic refresh workflow | Connect results back to creative variants without overstating causality |

Representative sources: [editor page](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/pages/editor.tsx), [composition types](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-composition/src/types.ts), [MCP tools](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-cli/src/mcp.ts), [runtime motion](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-video-runtime/src/systems/motion.ts), [publishing workflow](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/orchestrator/src/workflows.js).

## 4. What the upstream projects do better

### The supplied link and the editor are different products

`diffusionstudio/lottie` is a focused agent-generated Lottie workflow and player. Its project consists of animation JSON, supporting assets, and optional control metadata. `diffusionstudio/editor` is the broader TSX-based video editor that matches Posterract's architecture and earlier repository plans. Neither should be treated as interchangeable with HyperFrames. [Lottie repository](https://github.com/diffusionstudio/lottie), [Editor repository](https://github.com/diffusionstudio/editor).

### Lottie: concrete advantages to borrow

**Typed, intentional controls.** The upstream player exposes scalar, color, vector, and text controls. Its metadata supplies labels, ranges, order, and linked control targets. Posterract currently enumerates scalar/color/text slot names and infers UI treatment from an authored override. That produces a weaker template-customization experience. Bring in a typed slot descriptor with the original value, meaningful label, constraints, and supported operations. [Upstream controls](https://github.com/diffusionstudio/lottie/blob/3c72912fad543897f90045ed4d355813837927fc/src/components/sidebar-right.tsx), [Posterract Lottie inspector](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/sidebar-right/inspector/lottie.tsx).

**Font and image asset loading.** The upstream canvas constructs a managed animation with an asset map. Posterract's current constructor passes the JSON without a corresponding managed asset map. This is a concrete compatibility gap for animations requiring external fonts or images; a particular file may still work when it embeds everything it needs. Add local asset resolution and representative font/image fixtures. [Upstream canvas](https://github.com/diffusionstudio/lottie/blob/3c72912fad543897f90045ed4d355813837927fc/src/context/canvas.tsx), [Posterract player](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-video-runtime/src/media/lottie.ts).

**Portable animation output.** Upstream bundles animations, images, and fonts into a project ZIP. Posterract's main delivery path is rendered media. An optional motion-component package/export would help users reuse assets outside a particular video. This should be scoped to supported animation formats; arbitrary Posterract scenes cannot automatically become equivalent Lottie JSON. [Upstream export](https://github.com/diffusionstudio/lottie/blob/3c72912fad543897f90045ed4d355813837927fc/src/lib/export.ts).

**Focused creation guidance.** The upstream skill includes motion, typography, diagrams, SVG compatibility, player contracts, and evaluation references. The lesson is to ship good authoring guidance and evaluation examples alongside runtime features. These are design-production assets, not merely more code. [Upstream skill materials](https://github.com/diffusionstudio/lottie/tree/3c72912fad543897f90045ed4d355813837927fc/skills/text-to-lottie).

Posterract has broader product scope: footage, audio, captions, editable video structure, agent canvas operations, exports, and social scheduling. The Lottie player does not establish an advantage over that complete workflow. Its advantages are concentrated in animation interchange, compatibility, and exposed controls.

### Diffusion Studio editor: stay close selectively

The upstream editor shares the code-as-document foundation, agent media tools, preview/export approach, and much of the editing UI. Its README also describes headless operation; Posterract contains its own headless connection state, so headless support should **not** be presented as an upstream-only feature. [Upstream editor README](https://github.com/diffusionstudio/editor/blob/d4faad7155cfc450c439fe0bc3745a90d8aa7593/README.md), [local CLI server](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/desktop/src/cli-server.ts).

One concrete current upstream addition worth evaluating is its timeline viewport read/write representation: zoom and horizontal position are expressed in time-based units to survive FPS changes. Posterract has its own timeline view helpers, but the corresponding upstream runtime files are absent. Compare the semantics before porting. [Upstream view read](https://github.com/diffusionstudio/editor/blob/d4faad7155cfc450c439fe0bc3745a90d8aa7593/packages/runtime/src/queries/timeline-view.ts), [view write](https://github.com/diffusionstudio/editor/blob/d4faad7155cfc450c439fe0bc3745a90d8aa7593/packages/runtime/src/actions/timeline-view.ts).

Posterract's source contains additions beyond the sampled upstream tree: timeline detail modes, component/code-motion rows, baking, vector/Lottie/diagram controls, caption cue editing, recovery surfaces, skills, and publishing integration. File presence is not a performance or reliability benchmark. Evaluate upstream fixes individually with fixtures; avoid importing their auth, billing, and app shell wholesale.

### HyperFrames: real advantages, with real limits

HyperFrames has HTML/CSS authoring, animation adapters, reusable catalog components, and rendering tooling. Its current Studio documentation goes substantially beyond a simple player: timeline editing, keyframes, motion paths, gesture recording, nested scenes, and keyboard navigation are documented. This makes it a useful source of concrete interaction patterns. [Official repository](https://github.com/heygen-com/hyperframes), [timeline editing](https://hyperframes.heygen.com/guides/timeline-editing), [animation editing](https://hyperframes.heygen.com/studio/animation).

Its documentation also explicitly recognizes source that cannot be rewritten safely: generated motion may require unrolling, and computed values may require source editing. HyperFrames does not make arbitrary code perfectly reversible through a timeline. Posterract should make that same boundary explicit while improving the user's choices at it. [Generated animation behavior](https://hyperframes.heygen.com/studio/animation).

Do not infer that HyperFrames is faster, produces better encoded output, or behaves more reliably on Posterract's target devices without running the same fixtures. This review did not benchmark those claims.

## 5. Editor UI: the highest-value redesign

### What I observed

The black/mint identity is coherent. Floating panels and the full canvas create a recognizable workspace. The current balance, however, sometimes makes the *workspace* feel more prominent than the video being edited.

In the inspected project, the collapsed timeline left a small central video surrounded by substantial unused space. Expanding the timeline exposed useful clip and waveform information, but part of the active composition sat behind the timeline dock. The mixer occupied a permanent lower-right area even though the immediate task was general editing. This is an observed layout problem; its frequency across other projects and resolutions still needs testing.

Several important operations are visually or structurally hard to discover:

- Export is exposed through scene selection in the inspector rather than as a persistent top-level action in the new command bar.
- The timeline starts minimized in the current layout defaults, despite timing being central to the product.
- The timeline's Clips/Animation/Everything setting is inside a menu.
- Many controls appear as small icons; the accessibility tree contains numerous unlabeled buttons.
- Scene chips show numbers while names depend on hover/help.
- The unselected inspector devotes substantial space to near-identical history entries showing time and file size.
- The agent control opens setup/client choices and prompt recipes; a recipe copies text for use elsewhere.
- Controls can dim after the pointer rests on the canvas, reducing visibility during deliberate inspection.

Sources: [layout defaults](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/context/layout.tsx), [command bar](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/shell/command-bar.tsx), [inspector](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/sidebar-right/inspector/inspector.tsx), [agent launcher](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/posterract-code-panel.tsx).

### Keep the floating design; introduce three useful workspace modes

| Workspace | Primary task | Canvas behavior | Timeline/panels |
| --- | --- | --- | --- |
| Storyboard | Organize scenes, hooks, references, and aspect variants | Infinite board; scene cards and references can coexist | Compact timeline; scene metadata and recipes |
| Edit | Cut footage, place text, correct captions | Active scene fits the unobstructed preview area | Timeline open; assets or transcript left; inspector right |
| Motion | Animate components and refine timing | Active scene with paths, anchors, guides, and optional ghost poses | Taller timeline, selected motion lanes, curve editor |

These are layouts over the same project and document, not separate editors or duplicated project formats. The publishing workflow should open from a persistent **Export / Schedule** action. It does not need another creation canvas.

When a user opens a normal video project, start in Edit unless they saved a different preference. A new motion-template project can start in Motion. Storyboard remains one click away and preserves your infinite-canvas direction.

### A concrete layout specification

Treat these as initial design values to test, not measurements of the current app:

- **Top bar:** 48–52 px; project name, meaningful scene label, save state, workspace switcher, agent status, Export.
- **Left rail:** 44–48 px; labeled tooltips and shortcuts. Drawer approximately 220–260 px when open, with Assets, Transcript, Components/Skills, and Exports.
- **Inspector:** approximately 272–304 px for readable controls; independently collapsible. Avoid showing every possible section at once.
- **Timeline:** roughly 220–280 px initially in Edit; 300–380 px in Motion on a sufficiently tall display. Resizable and restorable. Keep the user's saved size.
- **Preview:** fit the active scene into the remaining rectangle. Opening a dock must not cover essential content in fit mode. Preserve a user's intentional manual zoom until they request fit again.
- **Mixer:** open on demand as an audio workspace panel. Do not reserve a permanent column during ordinary video editing.
- **Spacing:** 4/8 px rhythm; 8–12 px panel separation; restrained corner radii. Give high-density rows a clearer shape than broad ornamental margins.
- **Typography:** 13–14 px operational labels; 12 px secondary labels; avoid sub-11 px critical text. Use mono for timecode and numeric values, not ordinary instructions.

At smaller widths, collapse a drawer or offer a focused panel before shrinking every control. At 1280×800, the selected scene, essential timeline operations, and primary action should remain visible. At higher display scaling, preserve usability rather than trying to fit the same number of controls.

### Make the design feel more polished

1. Use dark neutral work surfaces with mint as selection/action emphasis. Keep the green atmospheric treatment in the surrounding workspace, with quieter panels around precision controls.
2. Increase text and separator contrast before adding more glow. Glow can reinforce one selected object or primary action; it should not make every boundary compete.
3. Reduce repetition: one main playhead time display, one save state, one obvious Export entry, one connection status.
4. Make hover and focus states intentional and consistent across the Solid editor and React publishing shell. Share design tokens; they do not have to share the same component framework.
5. Keep floating panel chrome visually light but give panel bodies sufficiently stable backgrounds to read over bright video frames.
6. Make transport and timeline controls feel like tools: generous hit targets, stable placement, clear tool state, and visible snapping/recording status.
7. Remove automatic focus dimming as a default. Offer a deliberate focus/presentation mode. A creator staring at a frame should not lose legibility elsewhere.
8. Replace unexplained icons with text where the function matters: **Fit video**, **All scenes**, **Export**, **Ask agent**, **Show animation**.
9. Use short, functional interface transitions for panel opening and selection. Reserve expressive motion for content, previews, and moments that help explain an action.

### The inspector should answer the user's current question

Use context and capabilities rather than a growing list of hand-maintained type-name conditions.

For selected text, show content and typography first, followed by layout and motion. For a clip, show trim/source, crop, speed, sound, then appearance. For a component, show its exposed controls and slots first. For a keyframe, show value, easing, and timing. For a scene, show format, duration, skill, and safe areas.

An empty selection should show scene-level context and useful next actions. Move full version history to a History drawer with thumbnails, operation names, authors, and affected elements. A list of 50 similar byte counts is storage history, not an understandable editing story.

Add a visible source-of-value indicator: **Fixed**, **Keyframed**, **Expression**, **Component control**, or **Asset slot**. Editing should behave differently in each case, and the UI should explain the result before it surprises the user.

### Canvas operations that would materially improve usability

- Click-through selection and a small overlap picker for stacked objects.
- Breadcrumbs into groups and component instances, with a clear return to the parent scene.
- “Reveal in timeline” and “Reveal on canvas” in both directions.
- Safe-area overlays by destination/format, treated as versioned guides rather than universal immutable platform rules.
- Crop and focal-point handles; preserve these when media is replaced.
- Alignment guides, padding measurements, anchor visualization, and lock/unlock controls.
- A canvas annotation tool: point to an object or region and attach a request at a specific time.
- Reference images and notes on the Storyboard outside the renderable scene. They must never accidentally export as part of the video.
- A minimap only when the board's extent warrants it; scene names and thumbnails are more useful than anonymous numeric chips.
- Compare variations side by side on the board, then enter focused editing for one variant.

## 6. “Every component and edit on the timeline”: a precise contract

### Separate three kinds of visibility

**Document structure:** scenes, groups, text, footage, audio, captions, vectors, diagrams, component instances, and embedded assets.

**Time-dependent behavior:** clip spans, transitions, animation segments, keyframes, procedural drivers, markers, caption cues, audio envelopes, and speed changes.

**Editing history:** “Moved title,” “Applied brand colors,” “Agent shortened the hook.” These belong in a transaction/history view linked to affected timeline objects. A move gesture should not create another permanent playback track.

This fulfills the intent without burying a video under hundreds of rows representing past mouse movements. Static effects can appear as expandable children of their owner; a property only needs a temporal lane when it changes over time.

### Promote the existing timeline views

Keep the implemented Clips, Animation, and Everything modes, but put the selector in the timeline header. Add selected-only and animated-only filters where useful. Display a summary badge on collapsed clips, such as “2 animations · 1 effect,” so motion never looks absent simply because the detailed rows are closed.

Use stable row categories and useful names. Generated material should arrive as “Headline entrance,” “CTA hold,” “Voiceover,” and “Logo reveal,” rather than a long sequence of “Group” labels. Color may reinforce media type but should not be the only identifier.

A representative hierarchy:

```text
Product launch · 30 seconds
  Hook scene · 0–4 s
    Headline · component instance
      Text / theme controls
      Entrance · 0.20–0.75 s
        Position Y · keyframes
        Opacity · keyframes
      Readable hold · 0.75–3.20 s
      Exit · 3.20–3.70 s
    Product shot · video
      Crop / focal point
      Camera push · 0–4 s
  Voiceover · audio
    Captions · timed words / cues
  Music · audio
    Ducking envelope
```

The initial view can collapse most of this. Selecting an entrance should reveal its lane, highlight the owning headline, and open the relevant controls.

### Component identity needs to become stronger

The existing component grouping uses the component definition's name and adjacent sibling runs. The source explicitly notes that two adjacent calls to the same component can read as one group. A heading is not yet a full component-instance editing model. [Timeline component grouping](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-video-runtime/src/queries/timeline-index.ts:174).

Introduce distinct identities for:

- Component definition and version.
- Component call/instance.
- Rendered element within that instance.
- Property/control within that element.
- Source location and supported write-back path.

Loop-generated instances need stable keys, not positional identities that change whenever an earlier item is inserted. Preserve instance identity during reordering and recompilation. Give users explicit actions for **Edit this instance**, **Edit all instances**, and **Detach**; explain the scope before applying the operation.

### Be honest about the three editability levels

| Level | Examples | What the user can do |
| --- | --- | --- |
| Native editable | Posterract text, paths, keyframes, sequences, supported effects | Direct canvas/timeline/inspector editing and source write-back |
| Parameterized component | Headline module, chart, map, caption layout | Adjust documented controls and timing; expand supported internal structure |
| Embedded/procedural | Arbitrary HTML, a custom surface/3D scene, imported Lottie internals | Edit wrapper transforms/timing and exposed parameters; inspect source; bake supported channels or convert a supported subset |

An imported Lottie has internal animation structure, but Posterract does not currently expose every internal shape as a native timeline object. A custom canvas or WebGL render can draw thousands of objects without creating Posterract entities. Promise internal selection only after an adapter supplies identity, bounds, controls, timing, and write-back behavior.

### Keep one canonical document

Use this architecture:

```text
TSX source + local assets + component manifests
                 ↓ compile / validate / stamp identities
Derived document index and render graph
        ↙              ↓                ↘
Canvas / inspector   Timeline         Agent context
        ↘              ↓                ↙
       Validated semantic transaction layer
                 ↓ source writer
          New project revision
                 ↓
       Preview / capture / local export
```

The document index is derived. It must not become a second saved source of truth competing with TSX. UI layouts, hover state, and view preferences should be separated from meaningful content revision tracking even if some existing source serialization remains for compatibility.

## 7. Connecting the user's agent more effectively

### Improve the workflow before adding an embedded chat client

Keep the user's own agent and model relationship. Posterract should provide context, operations, visibility, and recovery. An embedded chat interface is optional; it is not a prerequisite for a much better agent experience.

The current launcher offers clients and copies recipes. Improve it with three explicit states: **Client available**, **Tools connected to this project**, and **Task running / awaiting review**. App installation or an open process is not proof of a working tool session. Show a project name, last successful handshake, and last completed operation. [Current launcher behavior](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/posterract-code-panel.tsx).

Add **Ask agent about selection** beside the inspector title and in the canvas context menu. The request should carry the actual selection and time, not merely generic prose. If a client supports message handoff, use a supported adapter. Otherwise label the action **Copy request with context** and make the next step explicit. Do not show a fake “working” state when only the clipboard changed.

### The agent's context packet

The current tools already provide source, selection, playhead, runtime tree, variables, geometry, validation, and captures. Unite these into a consistent project-scoped packet, with expensive image/media data fetched on demand:

```text
projectId, projectRevision, sessionId, protocolVersion
activeSceneId, selectedInstanceIds, selectedElementIds
playheadFrame, fps, sceneDimensions, selectedTimeRange
targetBounds, parentPath, sourceLocations
editableProperties and their value origins
activeSkill and version, component schemas
locks, constraints, safe-area profile
compile status, mounted revision, pending saves
asset readiness and render warnings
```

Return stable IDs and source paths together. Give the agent a compact neighborhood around the selection; let it request the full tree only when needed. Add revision-based change feeds so it does not repeatedly read a complete project for a one-word correction.

### Make semantic edits complete operations

Current canvas mutations operate through the document editor, while persistence is debounced. Their immediate responses primarily describe canvas state. Source writes already include a file revision check. Extend this into an operation contract; do not discard those protections. [Canvas methods](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/context/agent-api/canvas.ts), [edit writer](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/projects/edits.ts), [source host](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/desktop/src/projects.ts).

Proposed transaction fields:

```text
projectId, expectedProjectRevision, operationId
label, requestedBy, targetIds, allowedScope
operations[], validationPolicy
```

Proposed completion receipt:

```text
operationId, beforeRevision, afterRevision
changedIds, changedFiles, affectedTimeRanges
persisted, compiledRevision, mountedRevision
diagnostics, previewArtifacts, undoTransactionId
```

A batch should be atomic from the user's perspective: validate targets and constraints, apply the operations, persist coherently, compile, wait for the intended revision to mount, then declare completion. Reject stale edits with a useful diff. Retrying the same operation ID must not duplicate clips or annotations.

Preserve direct small edits for users who want autonomy. Add preview/review for broad changes, with user-configurable scope and a meaningful before/after. Do not impose approval dialogs on every numerical edit.

### Let the agent use the canvas intelligently

Build a loop around the existing geometry and capture tools:

1. Read the selected object, frame, component context, and constraints.
2. Inspect relevant bounds and media/transcript evidence.
3. Propose or execute a scoped semantic change.
4. Wait until the changed source is saved and mounted.
5. Capture before/after at the actual changed frame and around the affected interval.
6. Check layout and timing, then provide a concise result linked to the affected objects.

Use geometry for exact questions and images for visual judgment. Rectangle overlap is not automatically a design failure: text intentionally sits over footage. Add semantic roles, clipping relationships, intentional-overlap annotations, and protected areas so the agent can distinguish intended composition from collisions.

`readGeometry({time})` currently moves the live playhead to make its measurement. Offer an offline observation path or save/restore the user's view state for background audits. The agent should not unexpectedly take over scrubbing while the user works. [Geometry implementation](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/context/agent-api/geometry.ts:100).

### A concrete request that should feel excellent

The user selects a headline and says: “Make this enter faster and stop covering the face.” The agent receives the selected element, parent scene, current time, and protected face region. It changes the entrance duration and vertical position, presents the two affected lanes, and shows the relevant before/after frames. The user can accept the change, drag its end time, or undo the named transaction.

This is more valuable than making the user rewrite a prompt with file paths, scene IDs, and timecodes they already pointed to in the editor.

## 8. Better animation: motion quality and motion controls

### Start from the capabilities already present

Posterract already has preset animation, spring/easing parsing, stagger, keyframes, vector trim/morph, diagram progress, and keyframe baking. Do not turn the roadmap into “add springs” or “add keyframes” as though none exist. Improve their discoverability, expressiveness, and consistency. [Motion system](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-video-runtime/src/systems/motion.ts), [baking](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/engine/bake.tsx).

### Build an animation inspector people can understand

- Three high-level sections: **Entrance**, **During**, **Exit**.
- Preview a preset on the selected element, with a clear reset/cancel path.
- Expose duration, delay, direction, travel distance, amount, anchor, easing, and stagger when relevant.
- Give entrances/exits visible time spans on the timeline, not just a name inside a dropdown.
- Make auto-keyframing an explicit state. A normal layout correction and an animated pose must not be confused.
- Put “Edit curve” beside the selected animation/keyframe; keep a larger curve surface available for precision work.
- Support retiming a selected set of keyframes around a chosen anchor, with readable numerical time input.
- Show motion paths and start/end poses on the canvas for supported position tracks.
- Add save/apply motion styles that contain editable parameters, not flattened video.

HyperFrames' current documentation provides useful examples of paths, gesture recording, generated-motion handling, and editing keyframes. Those are interaction references, not evidence that its whole runtime should replace yours. [Official motion editor documentation](https://hyperframes.heygen.com/studio/animation).

### Ship a curated library before a large catalog

Start with roughly a dozen carefully designed families; expand only when creators can use and modify them successfully:

| Family | Useful controls | What makes it good |
| --- | --- | --- |
| Headline reveal | Words/lines, distance, stagger, direction, hold | Text settles early enough to read |
| Caption emphasis | Highlight word, active color, scale amount | Speech timing remains accurate |
| Product entrance | Crop, shadow, scale, angle, easing | Subject remains recognizable and stable |
| Camera move | Start/end framing, focal point, easing | Motion directs attention without losing subject |
| Diagram draw | Node timing, path progress, labels | Reveals relationships in a logical order |
| Data/chart change | Data, labels, axes, duration | Data remains accurate; axes and units stay visible |
| Logo reveal | Shape/path source, stroke, fill, hold | Preserves geometry and brand proportions |
| Lower third | Name, role, alignment, entrance/exit | Avoids faces, captions, and destination UI |
| Match transition | Source/target anchors, timing, direction | Connects scenes meaningfully |
| CTA end card | Message, brand, duration, layout | Gives the viewer enough time to act |
| Beat accents | Chosen markers, intensity, recovery | Supports the music rather than hitting every beat |
| Reusable background | Palette, pattern, motion strength | Adds texture without competing with content |

Each family should include a real scene example, exposed parameters, named internal elements, reduced-complexity variant, thumbnail/preview, and quality fixtures.

### Motion quality must be evaluated over time

An attractive still frame does not prove a good animation. Review entry, readable hold, exit, transitions, audio alignment, and the first/last frame of the export.

Automated checks can catch missing assets, off-frame elements, insufficient caption duration, clipped text, flashes, and likely unintended gaps. Treat these as checks with evidence, not a universal aesthetic score. Ask a creator to compare two versions for readability, pacing, hierarchy, and usefulness.

### Next-level functionality, after the foundation

- Gesture recording with keyframe simplification and undo; it must produce ordinary editable tracks.
- Constraint-based motion: follow a target, maintain a margin, remain inside a safe area, attach a label to a moving subject.
- Word/beat anchors so entrances can follow narration timing without copying magic numbers.
- Responsive components that reflow for 9:16, 1:1, and 16:9, preserving human overrides.
- Better audio envelopes, voice/music role assignment, ducking controls, and useful loudness feedback.
- Speed curves with synchronized picture/audio handling, rather than merely adding a speed slider.
- A supported SVG path editor and morph compatibility diagnostics; incompatible morphs should explain the limitation.

## 9. A custom HyperFrames-like system inside Posterract

### Compare the three architectural options

| Option | Benefits | Costs/risks | Recommendation |
| --- | --- | --- | --- |
| Extend the native Posterract composition/runtime | Reuses timeline, source writer, media, export, agent API; strongest path to native editing | Must build component metadata and richer motion UX | **Primary direction** |
| Add HyperFrames through a bounded adapter | Makes HTML-based compositions/catalog material available; useful for a compatibility spike | Two render systems, timing conventions, media ownership, fonts, and export integration | Explore after the native contract is specified |
| Replace the editor/runtime with a broad HyperFrames fork | Direct access to that ecosystem | Migration, duplicated product work, source-format compatibility, ongoing upstream maintenance | Defer; evidence does not justify it now |

A custom branded motion SDK can be a layer over the existing primitives. It does not require rebuilding Skia, browser layout, a codec stack, or an animation engine from zero.

### Proposed component manifest

The following is a design proposal, not an existing Posterract API:

```text
identity: component ID, version, compatibility range
controls: text, color, number, enum, asset, duration
slots: product image, logo, caption data, voiceover
timing: entrance, hold, exit, duration constraints
structure: named child objects and instance identities
editability: direct, bound, procedural, embedded
layout: allowed formats, anchors, constraints
rendering: deterministic seek, prepare, dispose
quality: required assets, expected frames, resource limits
provenance: component/skill version and source attribution
```

One component inserted by an agent should expose the same controls and rows as one inserted from the component browser. Avoid a separate “AI result” format that leaves the human with an opaque render.

### If you add an HTML/HyperFrames adapter

Begin with a small compatibility spike using a title, nested scene, chart, image, and audio-backed composition. The adapter should map into the existing editor contract:

- Stable element and animation IDs.
- One scene clock with clear frame/second conversion.
- `prepare`, deterministic `seek`, capture, and disposal.
- Declared media ownership so sound/video do not run on two clocks.
- Extracted document index, bounds, exposed controls, and capability declarations.
- Source edits only for explicitly supported constructs.
- Local asset/font resolution and packaged dependencies.
- Isolation consistent with the existing editor boundary.

A wrapper clip is an acceptable first result **if labeled as an embedded composition**. It is not evidence that every DOM or 3D child is natively editable. Expand editability only when the adapter can preserve source and render equivalence.

Define go/no-go criteria before the spike: representative preview/export parity; random-seek stability; no duplicate audio; working save/reopen/undo; acceptable memory and seek latency on target devices; and a clear migration story. If these fail, continue native authoring while importing rendered assets where appropriate.

### Determinism and portability

Pin dependencies used to render a project. Freeze asset and font identities into a render manifest. Seed randomness; derive motion from the scene clock; eliminate wall-clock dependence from supported components. Record unsupported behaviors rather than claiming every possible script is deterministic.

Test random seeks, forward playback, backward scrubbing, fresh export, and reopened projects. Compare rendered frames within defined tolerances. Encoded MP4 bytes do not need to be identical across GPUs/codecs to establish visual parity.

## 10. Social posting and scheduling: improve the complete journey

### Present the actual publishing capability

The current composer exposes Instagram, TikTok, Facebook, and Threads. YouTube and X are explicitly “coming soon.” There is broader capability/connector code, but it is not equivalent to availability in the current product flow. Keep product copy, docs, agent capabilities, and UI driven by the same availability registry. [Current platform IDs](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/contract/src/index.ts:24), [composer](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/web/src/routes/_app/compose.tsx).

TikTok currently uses inbox draft upload and can return `awaiting_user`; the transmissions UI already has “Finish in TikTok.” Show that distinction before scheduling, on the calendar item, and after delivery. A scheduled draft delivery is not a promise that the post is public at that time. [Connector dispatch](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/orchestrator/src/worker.js:448), [transmissions UI](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/web/src/routes/_app/transmissions.tsx:31).

### Improve the calendar

The inspected calendar has a large introductory header and separate New post block above the working grid. On the observed laptop-sized window, that pushes useful calendar rows below the visible area.

Use a compact working header: month/week navigation, Today, account filter, timezone, and New post. Reserve the larger explanation for an empty or first-use state. Post cards should show thumbnail, short title, exact account, platform, scheduled time, and status. Add an agenda/list mode for dense schedules or small windows.

Show per-destination status for partial success. A grouped campaign may contain one live Reel, one failed destination, and one TikTok draft requiring action. One generic green card loses essential information.

Preserve the current drag-reschedule functionality, adding a concise destination/time preview and an undo action. Use calendar-date operations for navigation; store UTC instants plus the user's chosen IANA timezone when preserving wall-clock scheduling intent.

### Improve the composer

Replace internal lore with direct labels at decision points: **Video**, **Caption**, **Accounts**, **Schedule**, **Publish**, and **Save draft**. The brand can remain expressive without making users decode “Containment field,” “Projection targets,” “Initiate Transmission,” or “Lock Trajectory.”

Specific changes:

- Durable drafts, including base caption, overrides, media, exact destinations, chosen time, and unsent edits. The inspected composer primarily uses component state.
- Exact account identity on each destination card. “Most recently connected account” is a weak default for creators managing several brands.
- Platform-specific preview, caption length, media constraints, and applicable options in one card.
- A clearly displayed timezone and explicit handling of nonexistent/ambiguous local times.
- A single meaningful readiness summary with actionable blockers and advisory warnings.
- A visible distinction between uploading a render, delivering a draft, scheduling a publish job, processing at a platform, and being publicly live.
- Preserve captions and account choices while replacing/re-exporting media.
- Reveal the source project and render revision from a scheduled post.

Existing preflight checks cover captions, some duration/size checks, and connection warnings. Extend this with capability-backed checks such as aspect ratio, codec, asset readiness, and exact destination validity. Backend rules remain authoritative. Disconnected destinations currently produce warnings in the frontend; decide explicitly whether a user can schedule a blocked draft or must resolve the account before submission. [Preflight implementation](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/web/src/engine/useEngine.ts:68).

### Make export-to-publishing feel like one continuous workflow

Keep local export as a first-class action. For a user choosing Schedule, let them select a verified export and carry project/scene/version information into the composer automatically.

The handoff should read: **Render ready → upload complete → destination checks → schedule saved.** Show which step is in progress. Support retry without losing the draft or creating another scheduled post.

For variants, store a relationship between the source scene and each format/hook render. A campaign could have a 9:16 Reel, a square feed version, and three hook alternatives. Each scheduled post must reference an immutable render, not a moving “latest export.”

After a source change, a scheduled post can show “A newer edit exists” and offer a deliberate replacement. Never silently change the asset of an approved scheduled post.

### Publishing reliability work worth prioritizing

Temporal scheduling and retry infrastructure already exist. Extend validation around provider boundary cases: acceptance followed by timeout, app/API retry, cancellation during processing, expired credentials, partial success, rescheduling near release time, and platform status polling. Use stored provider IDs and reconciliation where possible; retrying must not duplicate a successful publication.

This is a proposed hardening matrix, not a claim that duplicate publication was reproduced in production. The three passing orchestrator tests cover the TikTok upload/draft path; they do not establish full platform end-to-end reliability.

## 11. Findings to fix before a large feature expansion

| Priority | Finding and evidence | Concrete correction |
| --- | --- | --- |
| P1 | **Animation view drops some sequence children.** A child with a preset animation but no keyframe track is filtered out. An isolated call to the actual timeline builder returned 0 rows in Animation and 1 in Everything; adding a keyframe track made Animation return 1. | Make admission aware of preset/procedural motion; add fixtures for nested sequences and all three detail modes |
| P1 | **Common inspector controls omit vector and Lottie selections.** Classification recognizes these types, but the Time/Transform conditions omit them, and the preset-animation section omits them too. | Replace repeated type-name lists with tested per-element capabilities; expose applicable controls consistently |
| P1 | **Render provenance can describe a different revision.** The export callback reads provenance after rendering; the hash covers the entry file, not all source/assets. | Freeze a project/render manifest before capture and carry that exact manifest through completion/upload |
| P1 | **Compile readiness is unknown to the agent.** Context explicitly returns `compileState: "unknown"`. | Publish queued/saving/compiling/mounted/error states with matching revision IDs; add a settle/wait operation |
| P1 | **Calendar navigation uses fixed 24-hour days.** DST reproduction: Oct 26, 2026 midnight + 7 fixed days becomes Nov 1 at 23:00 in America/Los_Angeles. | Use calendar-date arithmetic for week/month cells and navigation; test spring/fall transitions and non-DST zones |
| P1 | **Canvas can be covered when the timeline expands.** Observed in the installed app; the source's initial fit is not a complete adaptive-fit policy. | Track fit/manual modes; recompute available rectangle when panels change; preserve deliberate manual framing |
| P2 | **Lottie compatibility and control metadata are incomplete.** Current player has no managed external asset map; vector slots are not returned; overriding a declared slot starts with numeric zero. | Load assets/fonts; expose typed slot descriptors/current values; add vector/RGBA support and useful labels/ranges |
| P2 | **Component headings do not uniquely identify component calls.** Adjacent same-name component outputs can share a heading. | Stamp instance identity and key paths; separate instance and definition editing |
| P2 | **Preflight memo misses account-set dependencies.** It depends on platforms and portals but not accountSetId/accountSets. Returning to Automatic selection or changing set data without another dependency changing can leave stale checks. | Derive exact destinations once and use them for UI, preflight, and payload |
| P2 | **Source location lookup checks only the entry file.** `locateProjectElement` reads `project.entry` even though projects can span multiple files. | Use stamped source paths or a project-wide source index for reveal/write-back |
| P2 | **Selecting a skill does not instantiate its starter.** Current installation writes a scene attribute and marker; discovery can report `hasStarter`, but that operation does not insert the starter. | Distinguish Attach guidance from Insert starter; implement a real previewed insertion path |
| P2 | **Export errors can look like an empty library.** Exports list catches errors and returns an empty array; recording errors are also suppressed in the completion path. | Show recoverable error/retry states; retain export success separately from metadata-recording success |

Sources: [timeline filter](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/packages/posterract-video-runtime/src/queries/timeline-index.ts:111), [inspector conditions](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/sidebar-right/inspector/inspector.tsx:153), [export completion](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/context/export.tsx:127), [provenance](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/projects/provenance.ts), [agent context](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/context/agent-api/context.ts:234), [calendar arithmetic](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/web/src/routes/_app/continuum.tsx:15), [source locator](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/desktop/src/projects.ts:845), [skill installation](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/engine/skill-deck.tsx), [exports library](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/editor-sandbox/src/components/sidebar-left/exports-view.tsx).

P1 means high priority within this improvement program; it does not mean a verified production outage. Apart from the two isolated reproductions and stated UI observations, these are source-backed findings whose full user-visible impact should be reproduced in fixtures before implementation.

## 12. Cross-platform release quality

The goal is one predictable product on three operating systems, with platform-appropriate shell behavior. Existing packaging uses Electron makers for macOS, Windows, and Linux; the current release workflow builds Windows/Linux, while macOS signing/notarization is handled separately. [Packaging](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/apps/desktop/forge.config.ts), [release workflow](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/.github/workflows/desktop-release.yml).

| Test area | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Installation/open | Signed/notarized downloaded build; quarantine path | Installer and packaged executable; typical user permissions | AppImage/deb on selected supported distributions |
| Agent connection | Actual installed client; project switch/reconnect | PATH/command wrappers; named pipe; spaces in paths | Unix socket permissions; client command discovery |
| Files/projects | Rename, move, recovery, external asset path | Drive letters, separators, long/Unicode paths, file locks | Case sensitivity, permission failures, file watcher behavior |
| Fonts/render | Bundled and project fonts; missing font fallback | Same fixtures and metadata | Same fixtures and metadata |
| GPU/media | Supported target hardware; codec fallbacks | Integrated/discrete GPUs; export codecs | Supported graphics stacks and software fallback |
| UI | Windowed/fullscreen; keyboard; scaling | 100/125/150/200% scaling; keyboard | Chosen desktop environments; scaling/shortcuts |
| Recovery | Kill during save/render; reopen | Same | Same |

Establish a small supported-device matrix, then run the same fixture projects on it. Do not equate passing a shared TypeScript check or producing an installer with validating native video behavior.

## 13. Suggested delivery roadmap

The estimates below are planning ranges, not commitments. They assume two experienced engineers who can cover editor/runtime and desktop/API work, with regular product design and QA involvement. Agent-generated code can reduce typing; it does not remove visual review, render validation, migrations, or device testing. Re-estimate after the first phase.

### Phase 0 — Baseline and fidelity: approximately 1 week

Create representative projects, capture the current behavior, make the findings reproducible, and define the supported-element capability matrix. Include short form, longer footage, native motion, Lottie with fonts/images, repeated components, and multiformat scenes. Confirm which installed build is being reviewed on each OS.

Exit: the team can reproduce the two verified defects, validate all other P1 findings, compare saved/reopened output, and describe what is currently editable.

### Phase 1 — Daily editing experience: approximately 2–3 weeks

Deliver focused Edit/Motion layouts, adaptive fit, persistent Export, visible timeline detail modes, readable controls, inspector capability fixes, better empty states, and meaningful history access. Fix the sequence-animation filter and date arithmetic in this window. Keep changes narrow enough to validate existing projects.

Exit: a creator can import footage, add text, find motion, adjust it, undo, export, and begin scheduling without hunting for controls.

### Phase 2 — Reliable agent collaboration: approximately 2–4 weeks

Build operation receipts, save/compile/mount readiness, project revision binding, selected-context requests, and a named activity/history surface. Add before/after preview for broad changes and non-disruptive canvas inspection. Freeze render provenance.

Exit: an agent edit is visibly attributable, targets the intended project, survives a retry without duplication, can be undone as one change, and exports the revision shown to the user.

### Phase 3 — Motion components and precise authoring: approximately 3–5 weeks

Build instance identity, exposed component controls, the motion inspector, temporal segment editing, curve/path affordances, and a curated component library. Improve Lottie typed controls/assets and complete starter insertion. Add responsive variants in a bounded set of components.

Exit: several genuinely useful components can be inserted by a human or agent, edited identically, retimed, and rendered across selected formats.

### Phase 4 — Delivery and campaign workflow: approximately 2–4 weeks

Deliver durable composer drafts, exact-account cards, platform-specific readiness, immutable render/variant associations, clear TikTok draft states, compact calendar/agenda, and publication failure recovery. Preserve existing Temporal architecture.

Exit: a user can produce variants, schedule exact renders, understand partial success, and return to the source project from a post.

### Phase 5 — Optional expansion, only after evidence

Run a time-boxed HTML/HyperFrames adapter spike, gesture recording, advanced motion constraints, or deeper 3D/vector tools according to observed demand. Do not schedule all of them at once. Choose the next investment using creator task success and demand, not feature-count comparisons.

A disciplined sequence is likely a multi-month program. The useful first release is Phase 1 plus the critical readiness/provenance work; it should not wait for every advanced idea.

## 14. Acceptance scenarios that define “next level”

1. **First edit:** a new creator imports a clip, adds a title, trims a section, and finds Export without instruction.
2. **No hidden motion:** a preset-only clip inside a sequence is represented in Animation view and can be revealed from the canvas.
3. **Selection agreement:** choosing a component/child from any surface selects the same object in canvas, timeline, inspector, and agent context.
4. **Component scope:** two instances of one component remain separate; editing one does not unexpectedly change the other.
5. **Human/agent round trip:** human change → agent change → human adjustment → undo → reopen preserves intended source and output.
6. **Stale edit:** an agent using an old project revision gets a conflict response, not silent overwriting.
7. **Retry:** resending an operation ID does not insert a second title or create another scheduled post.
8. **Completed means ready:** an operation receipt's mounted revision matches the source used for the preview/capture.
9. **Procedural conversion:** bake supported code motion, retime it, remove the bake, and recover the original driver.
10. **Lottie compatibility:** external font/image assets and typed slots work in preview, reopen, and export for the supported fixture set.
11. **Timeline/preview fit:** expanding panels at 1280×800 does not obscure the active scene in fit mode; manual zoom stays predictable.
12. **Export race:** editing an imported component during a render does not relabel the output as the newer revision.
13. **DST:** week/month navigation and schedule entry behave correctly across spring-forward and fall-back in multiple zones.
14. **Publishing partial success:** one destination live, one blocked, and one awaiting user are displayed separately with the correct next action.
15. **Crash recovery:** killing the app during a save or render never leaves an apparently valid but corrupted canonical project.
16. **Cross-platform parity:** supported fixture outputs and key interactions pass on the agreed Windows/Linux/macOS device matrix.

## 15. Measure outcomes instead of counting features

First gather a baseline. The following are proposed targets, not current measured performance:

- Most participants in a small representative usability study can complete the first-edit flow without moderator intervention; record where they hesitate and why.
- Selected element reveals in the other surfaces immediately enough to feel connected; target under 100 ms for the UI update on the agreed baseline fixture/device.
- Set a warm-seek latency budget, initially around 150 ms for a representative short project, then tune to media decode complexity and device class.
- No missing timeline representation for supported animated object types in the fixture matrix.
- No data loss or duplicate mutation in conflict/retry tests.
- Every completed render has a frozen manifest and every scheduled post points to a verified immutable media asset.
- Track time from first agent request to a verified editable result, number of repair turns, and percentage of agent results the creator can adjust manually.
- Track export success, memory, seek latency, dropped frames, upload recovery, and publication outcomes by OS/build and fixture/category.
- Measure return-to-edit and schedule completion, without collecting source content or media unnecessarily.

For creative performance, compare hook variants and formats within meaningful contexts. Views and retention are influenced by audience, timing, distribution, and topic. An analytics loop can suggest what to test next; it cannot honestly declare a motion preset the causal winner from unrelated posts.

## 16. Discovery work that should precede the larger bets

Run focused sessions with approximately 5–8 creators spanning footage editing, motion graphics, and agency/multi-account publishing. Include people who already use coding agents and people who do not. The small sample is for finding interaction problems, not estimating market-wide conversion.

Have participants perform the same tasks in the current app and the proposed interaction model: find an animated title, shorten an entrance, replace media, ask their agent to fix a selected region, undo the result, export, and schedule the correct variant. Observe behavior rather than asking only whether the design “looks nice.”

Resolve these questions before deep investment:

- Do creators start from footage, a script, a reusable component, or an agent prompt most often?
- How often do they need the infinite board during actual cutting, versus a focused preview?
- Which external agents and handoff capabilities matter most in practice?
- How much internal editing do they expect inside imported Lottie/HTML/3D assets?
- Which five motions repeat most often across real customer projects?
- Is their main publishing friction captions, account selection, variants, approval, or failure recovery?
- Are Windows/Linux users encountering media/GPU problems that dominate UI improvements?

The recommended immediate investment remains clear even before those answers: make the existing editor easier to operate, make motion visible, make agent completion trustworthy, and connect source revisions to published media.

The companion prioritized task list is [posterract-next-level-backlog-2026-09-05.md](/Users/sinapahlevan/CODING%20PROJECTS/vidtryx/docs/posterract-next-level-backlog-2026-09-05.md).
