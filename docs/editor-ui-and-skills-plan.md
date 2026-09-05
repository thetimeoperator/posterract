# Posterract editor: Skill Deck + UI redesign plan

Status: proposed, Sep 3 2026. Written for the build agent. Grounded in the current code — every file named below exists unless marked NEW.

Two workstreams:

1. **Skill Deck** — a per-scene skill picker: an animated pop-up on the infinite canvas that lets the user attach a *skill folder* (a content type: Lead With Animations, Clipping, UGC Ad, Talking Characters, Script Beats, Trending News, Globe…) to a scene. The choice is written into the source (`<scene skill="…">`), shown on the scene, and handed to the agent.
2. **Editor redesign** — same core (left assets/layers, center infinite canvas, right inspector, bottom timeline), but canvas-first proportions, floating glass panels, a top command bar, a cleaner timeline, and one consistent visual language built on the locked brand (black `#05080b`, neon `#65ff9a`, mint `#eafff3`, cyan `#7cf7ff` secondary).

Principles that do not move: every edit lands in the code AND the timeline; plain product language leads (the word is "Skill", not lore); exports stay local; no purple; the POSTERRACT wordmark is visible.

---

## Part 1 — Skill Deck

### 1.1 What a skill is, on disk

A skill folder is the Agent Skills format the founder already uses: a folder with `SKILL.md` (frontmatter `name`, `description`) plus `assets/`, `references/`, `examples/`, `config/`, `scripts/`. Real examples on this machine:

| Folder | name | What it makes |
|---|---|---|
| `AI FOR SAVAGES/lead-with-animations-clean` | lead-with-animations | 9:16 short, full-screen animations lead, circular avatar upper-left, 3-word glowing captions |
| `AI FOR SAVAGES/clipping-skill-v3` | clipping-skill-v3 | captioned vertical clips from a long video (moment selection, face-aware crop) |
| `AI FOR SAVAGES/UGC-skill` | ugc-ad-video | 9:16 UGC ad from product photo + avatar photo |
| `SINA AGENT SKILLs/multiple_talking_characters_skill` | multiple-talking-characters | two-character dialogue shorts with voices and rotating backgrounds |
| `SINA AGENT SKILLs/script-beats-to-video` | script-beats-to-video | script → ordered visual beats → one image per beat → video |
| `trending-news-character-skill-holyversion/skills/trending-news-character-skill` | trending-news-character-skill | topic → verified script → 9:16 with animations top, avatar bottom |
| `globe-video-engine-v2/skills/globe-video-agent` | globe-video-agent | semantic 9:16 globe videos (routes, incidents, comparisons) |

Posterract adds a **card manifest** to a skill folder, optional, so a plain SKILL.md folder still works:

```
<skill>/posterract.json
{
  "cover": "assets/cover.png",        // 9:16 or 1:1 image shown on the card; fallback: first image in assets/, else a generated glyph
  "format": "9:16",                   // 9:16 | 1:1 | 16:9 — pre-selects the scene preset
  "duration": [20, 60],               // typical seconds; shown as "20–60s"
  "tags": ["avatar", "captions", "hook"],
  "requires": ["heygen", "fish"],     // BYO keys the skill needs; card shows which are missing
  "starter": "examples/starter.tsx",  // optional scene scaffold inserted on install (see 1.6)
  "recipes": [                        // optional; default = "Run this skill on the scene"
    { "label": "Write the script", "prompt": "…" },
    { "label": "Build the scene from the script", "prompt": "…" }
  ]
}
```

### 1.2 Where skills come from (three sources, one list)

1. **Bundled starters** — shipped with the app under `.posterract/docs/examples` today (talking-head, podcast-clip, short-form-video, motion-graphics, product-demo, diagram-explainer). Promote each to a real skill folder under `apps/desktop/skills/<name>/` staged into the app like the SDK, so the deck is never empty.
2. **User library** — `~/Posterract/Skills/<folder>` (created on first launch). "Add skill folder…" in the deck opens a folder picker and **copies** the folder there (never symlinks into a repo the user may move).
3. **Project skills** — `<project>/skills/<folder>` for skills that belong to one project. Listed first, tagged "This project".

Desktop main scans all three on project open and on a folder watcher (`fs.watch` on the two roots, debounced 500 ms). Parsing: frontmatter `name`/`description` from `SKILL.md`, then `posterract.json` if present, then cover detection. Result cached per folder mtime.

### 1.3 Where the choice lives (both ways: code and canvas)

- `<scene skill="lead-with-animations">` — a new optional string attribute in `SceneProps` (`packages/posterract-composition/src/types.ts:487`). The value is the skill's `name`. Unknown values are allowed (the folder may live on another machine); the UI shows them as "Skill not installed" with an "Add folder…" action.
- Runtime: new tag-with-value trait `SceneSkill = trait({ value: '' })` in `packages/posterract-video-runtime/src/traits/node.ts`; mapped from the prop in `packages/posterract-video-reconciler/src/document.ts` next to `name`.
- Write-back: `DocumentEditor.setProperties(scene, { skill })` goes through the existing ts-morph funnel, so it is undoable, snapshotted, and visible in the code panel immediately.
- Provenance: `apps/editor-sandbox/src/projects/provenance.ts` adds `skill` to the export record and to the uploaded asset's provenance columns (`012-provenance.sql` gains `skill text`). This is what later lets the analytics loop answer "which skill performs".

### 1.4 The Skill Deck — what the user sees

**Trigger points**
1. **New scene.** After `createScene` (`apps/editor-sandbox/src/engine/new-scene.ts`) places the frame from `scene-init-overlay.tsx`, the deck fans out around it. Escape or "Blank scene" dismisses.
2. **Scene header chip.** Every scene frame gets a chip in its title bar: `⚡ Lead With Animations` or `+ Skill` when empty. Click reopens the deck anchored to that scene.
3. **Keyboard.** `S` with a scene selected.
4. **Drop.** Dragging a skill folder from Finder onto a scene installs it (reuses the file-drop path in `scene-init-overlay.tsx` / `engine/asset-actions.ts`).
5. **Agent.** New MCP tool `posterract_set_skill { sceneId, skill }` and `skill` in `posterract_get_context` — the agent can pick or read it.

**Anatomy** (screen-space, independent of canvas zoom)
- A soft backdrop (`--overlay-soft`) fades in over the canvas; the anchored scene stays at full brightness with its neon ring.
- Cards fan in an **arc around the scene frame**: up to 7 visible, centered above the scene, radius = 0.9 × scene screen height, arc span 110°. More than 7 → the arc becomes a horizontal carousel with the same cards; wheel/trackpad scrolls it.
- Card 196 × 292 px, radius 10. Black glass: `rgba(5,10,7,.82)` + `backdrop-filter: blur(18px)`, 1 px edge `rgba(101,255,154,.18)`, corner HUD brackets (brand heritage, 10 px). Cover fills the top 60% with a subtle scanline gradient; below: name (Inter 13/600 mint), one-line description (11/400 at 62%), chips row (format · duration · requires), and a footer "Starter included" or "SKILL.md only".
- A **search field** floats above the arc ("Search skills…", `/` focuses). Filtering re-fans the arc.
- Two special cards close the arc: **Blank scene** (ghost outline) and **Add skill folder…** (dashed edge, plus glyph).
- Missing requirement (e.g. needs a Fish key you have not pasted): the chip turns amber and the card's primary action reads "Add key" (opens the existing Keys card in the AI Generate panel).

**Hover / focus**
- Card lifts 8 px, tilts toward the pointer up to 6° (`perspective: 900px`), edge light brightens to `rgba(101,255,154,.45)`, and a **ghost of the skill's layout** is drawn inside the scene frame behind it (from `starter` if present: avatar circle top-left, caption zone, safe areas), so the user sees what the skill will do to the scene before choosing.

**Choose**
- The card flies into the scene frame (transform to the frame's rect, 260 ms spring, stiffness 320 / damping 28), dissolves at scale 1.04, and the header chip pops in (scale .8 → 1, 220 ms). The backdrop and other cards fade in 160 ms.
- Source updates: `skill="…"` written; if the skill has a `starter`, the scaffold is inserted (1.6) as one undo step named "Install skill: <name>".
- Timeline: a marker `Skill: <name>` is added at 0 s so the change is visible there too (markers are source elements already).

**Reduced motion:** fades only, no arc, cards in a grid.

### 1.5 After a skill is attached

- **Scene title bar** shows the chip; hover shows the skill's description; click → deck.
- **Inspector (scene selected)** gets a "Skill" section at the top: cover thumbnail, name, description, format/duration, "Open folder", "Change", "Remove". Recipes from `posterract.json` render as buttons that copy the prompt (same behavior as the agent panel's "Ask it to").
- **Agent panel** ("Ask it to") lists the active scene's skill recipes first, under the skill's name, then the generic recipes from `engine/agent-recipes.ts`.
- **Agent context**: `posterract_get_context` returns per scene `{ skill: { name, path, hasStarter, requires } }`; the project guidance gains one line: "A scene may declare `skill`; read that folder's SKILL.md before editing the scene." The MCP server instruction gains the same sentence.
- **Exports** carry the skill name in provenance and show it in the Exports view row.

### 1.6 Starter scaffolds (optional per skill)

A `starter.tsx` is a scene body written in the composition SDK with placeholders: `<Slot name="avatar">`, `<Slot name="captions">`, `<Slot name="b-roll">`. Installing a skill with a starter replaces an **empty** scene's children with the scaffold; a non-empty scene gets the scaffold appended as a group named after the skill, never replacing content. Slots render as dashed neon outlines with the slot name until filled (drop an asset, or the agent fills them). This is what makes a skill feel like a *template that knows what it wants*, not just a label.

### 1.7 Covers and logos — no card is ever blank

Every skill has a face, and the same face appears everywhere the skill does (deck card, scene title chip, inspector, exports row, agent panel). Resolution order:

1. `posterract.json` → `cover` (any image; 9:16 preferred).
2. `assets/cover.png` / `cover.jpg` / `logo.png` / `logo.svg` in the skill folder.
3. The first image in `assets/` (largest by pixel count).
4. **Generated sigil** — a deterministic mark drawn from the skill name: a hex or reactor-shaped glyph on black glass with a two-letter monogram, neon or cyan by hash, with unique cut angles per name. Same name → same sigil on every machine. Drawn with Canvas2D at 512 px, cached in `~/Posterract/Skills/.covers/<name>.png`.

Two ways to set a cover from the UI: **drag an image onto the card** (copied to `assets/cover.png`), or **Generate cover** (the user's own image key, Gemini, from the skill's description; saved to the folder; never automatic, never billed without a click). The **logo** is separate from the cover: a small 20 px badge (the sigil, or `logo.svg` when present) sits bottom-left of the cover on the card and is what the scene chip and inspector show. Card cover treatment: 9:16 crop, scanline gradient, neon edge light on hover; covers desaturate 20% when the skill's requirements are missing.

### 1.8 Files

| Layer | File | Change |
|---|---|---|
| desktop | `apps/desktop/src/skills.ts` NEW | scan roots, parse frontmatter + manifest, cover detection, watcher, copy-in |
| desktop | `apps/desktop/src/channels.ts` + `apps/editor-sandbox/src/bridge/main-channels.ts` | `SKILLS_LIST`, `SKILLS_ADD_FOLDER`, `SKILLS_REVEAL`, `SKILLS_READ_STARTER` |
| desktop | `apps/desktop/src/main.ts` | handlers; stage bundled starters like the SDK |
| composition | `packages/posterract-composition/src/types.ts` | `SceneProps.skill?: string` |
| runtime | `packages/posterract-video-runtime/src/traits/node.ts` | `SceneSkill` trait |
| reconciler | `packages/posterract-video-reconciler/src/document.ts` | prop → trait |
| editor | `apps/editor-sandbox/src/lib/skills.ts` NEW | client cache, search, requirement check against `ai-bridge` key status |
| editor | `apps/editor-sandbox/src/components/canvas/skill-deck.tsx` NEW | the deck (arc layout, cards, ghost preview, animations) |
| editor | `apps/editor-sandbox/src/components/canvas/draw-overlay.tsx` | scene title bar + skill chip |
| editor | `apps/editor-sandbox/src/engine/new-scene.ts` | open deck after create |
| editor | `apps/editor-sandbox/src/engine/skills-install.ts` NEW | write `skill`, insert starter, add marker, one undo step |
| editor | `apps/editor-sandbox/src/components/sidebar-right/inspector/scene-skill.tsx` NEW | inspector section |
| editor | `apps/editor-sandbox/src/engine/agent-recipes.ts` | skill recipes first |
| editor | `apps/editor-sandbox/src/context/agent-api/context.ts`, `canvas.ts` | `skill` in context; `setSkill` |
| cli | `packages/posterract-cli/src/mcp.ts` | `posterract_set_skill` |
| provenance | `apps/editor-sandbox/src/projects/provenance.ts`, `deploy/posterract/postgres/init/013-skill-provenance.sql` NEW | `skill` column |
| docs | `posterract-skill/SKILL.md`, scaffolded guidance in `apps/desktop/src/projects.ts` | one line each |

Acceptance: create a scene → deck appears → choose Lead With Animations → chip shows, code shows `skill="lead-with-animations"`, marker at 0 s, undo removes all three; `posterract_get_context` reports it; export provenance carries it; a folder dropped on a scene installs; a skill folder without `posterract.json` still shows a card.

---

## Part 2 — Editor redesign

Current shell (`apps/editor-sandbox/src/pages/editor.tsx`): grid columns `264px | 1px | 1fr | 1px | 264px`, rows `1fr | 1px | 32px | timelineHeight` with `DEFAULT_TIMELINE_HEIGHT = 234`, `MIN_TIMELINE_HEIGHT = 120` (`context/layout.tsx`). Bottom row = `Layers` (264) + `Timeline` + `Soundboard` (264). Theme tokens in `src/index.css`; brand overrides at the `.posterract-editor-shell` block (`--posterract-neon: #65ff9a`, translucent panel backgrounds). Fonts already local: Inter, JetBrains Mono.

### Move 1 — Everything floats: one canvas, instruments on top
The founder's ask: the timeline and the side components should be *floating*. So the model changes from "a grid of boxes with a canvas in the middle" to **"one full-window canvas with glass instruments floating over it."** Nothing has a seam; the 1 px `bg-border-strong` dividers go away.

**The instruments** (all glass: `--surface-1` over `backdrop-filter: blur(20px)`, radius 14, edge 1 px `--edge`, shadow `0 24px 48px -24px rgba(0,0,0,.85)`, inset 12 px from the window edge):
- **Command bar** — top, full width minus insets, 40 px.
- **Rail + drawer** — left, 48 px rail, 220 px drawer when open.
- **Inspector** — right, 248 px.
- **Timeline dock** — bottom, full width between rail and inspector, **168 px** default (ruler 28 + 3 lanes × 40 + 20 padding), minimum 96. It is a card, not a row: rounded, floating 12 px above the window edge, with the layer names as its left column and the ruler inside it.
- **Mixer, Skill Deck, Agent panel** — pop-overs that float where they are needed (mixer bottom-right, deck around a scene, agent panel over the Core button).

**Docked or free.** Every instrument has a grab zone (top 8 px) and a pin. Pinned = docked to its edge; unpinned = **free-floating**: drag it anywhere over the canvas, it snaps to other instruments and to the window edges at 12 px, and it remembers its place per project. Typical use: unpin the timeline dock and park it right under the active scene, half width, so the scene and its timeline sit together like one object. Double-click the grab zone to re-dock.

**Collapse states.** Timeline dock → **Peek** (`T`): a 44 px pill with the scrubber, playhead time and scene chips. Drawer → rail only (click the active icon). Inspector → a 40 px vertical tab. `⌘\` hides every instrument (today's `uiVisible`).

**The canvas underneath.** Full-bleed, behind everything. The engine's `fit`/`fitToScenes` receives the **visible rect** = window minus *docked* instruments (free-floating ones do not reduce it), so "fit all" never hides a scene under a panel. Pointer events in the gaps between instruments reach the canvas; the instrument layer is `pointer-events: none` with `auto` on each card.

**Focus fade.** When the pointer rests on the canvas for 1.5 s, every instrument dims to 62% opacity and loses its shadow; any hover restores it in 140 ms. Off in a preference. This is how the canvas becomes the whole window without hiding the tools.

**Implementation.** `pages/editor.tsx` stops being a CSS grid: a canvas layer (`absolute inset-0`) plus an instrument layer. `context/layout.tsx` grows an instrument store — `{ id, edge: 'top' | 'left' | 'right' | 'bottom' | 'free', size, collapsed, x, y }` per instrument, persisted as `layout.instruments` per project; existing `timelineHeight` / `timelineMinimized` map onto it. A small `components/shell/instrument.tsx` NEW wraps each panel with the glass, grab zone, pin, collapse and snapping; `Canvas` reads `visibleRect()` from the store.

### Move 2 — The canvas as the hero
- Ground `#05080b`; the heritage **84 px chamber grid** at 5% mint, a center radial glow (`rgba(101,255,154,.10)` → 0 at 60% radius). Dot grid switches on above 150% zoom.
- Scenes as **glass slabs**: 1 px mint edge at 14%, active scene gets a 2 px neon ring + 24 px outer glow; inactive scenes at 85% brightness.
- **Title bar inside the frame** (top 28 px, glass): `02 · Implanted Thoughts` left, skill chip center, `9:16 · 0:31` right in mono. Replaces the floating titles and the grey "Active" chip.
- **Minimap** bottom-right (120 × 72) when > 3 scenes; click to jump.
- **Telemetry corner** bottom-left, mono 10 px at 50%: zoom %, playhead, pointer position in scene space. This is the HUD readout heritage, made useful.
- Shortcuts: `⇧1` fit all, `⇧2` fit active, `⇧3` 100%.

### Move 3 — Top command bar (new, 40 px, glass, full width)
- Left: **POSTERRACT** wordmark (mono, tracking .18em, mint) · project name · Saved pill (moved from the inspector header).
- Center: **scene switcher** — chips `01 02 03`, active filled neon; each chip carries a tiny progress bar (how much of the scene has content).
- Right: `⌘K` command palette · zoom readout · **Export** (primary neon) · agent status dot (green = connected; click opens the agent panel).
- Removes: the "Editor · Saved · 14%" header from the inspector, the project name from the left sidebar, the timeline title row when the switcher is present (saves 32 px).

### Move 4 — Left rail, two levels
- A **48 px icon rail**: Assets, Skills (new), Layers, Exports, and the **Core** button (a small reactor glyph; breathes on a 4 s cycle when the agent is connected, dim when not). This replaces the two mono "AI Generate / AI Agent" pills — generation and agent live behind the Core button as two tabs.
- A **220 px drawer** opens next to the rail for the selected icon; `⌘1–5` switch; clicking the active icon closes the drawer (canvas gets 268 px more).
- Assets: the three giant folder icons become a **compact tree** (folder rows 28 px) with real thumbnails for files, list/grid toggle, drag handles, and a search that filters as you type. Exports: rows with thumbnail, format, duration, "Schedule" action.

### Move 5 — Layers and timeline as one instrument
- Layer checkboxes → **eye and lock glyphs**, shown on hover, persistent when off.
- **Captions lane**: all `Caption 0xx` rows collapse into one lane with pill segments; click a pill to edit the cue inline (cue editor exists); expand the lane to see rows.
- Clip colors by kind: video slate, audio teal with waveform, text mint, captions neon outline, component rows white outline, live rows dashed neon.
- Layer names truncate with a fade, and show full on hover.

### Move 6 — Ruler and markers
- Markers move to their **own 14 px lane** above the ruler; labels sit to the right of the flag and never overlap time labels.
- Playhead: 1 px neon line with a mono time bubble at the top; pulses gently on play.
- Right end of the ruler: zoom slider + snapping magnet + "Peek" toggle.

### Move 7 — Right inspector: contextual card stack
- Empty state becomes the **Scene card**: format, duration, fps, skill, safe-zone toggles (TikTok / Reels / Shorts overlays), background. "No layer selected" disappears.
- **Version history** collapses to one row: `50 versions · last 19 h ago · Browse ›`. Browse opens the full list in a sheet with a sparkline of size over time and "Restore" per row. The identical `206.6 kB` lines stop being a wall.
- Sections are accordions with sticky 28 px headers; values in mono with tabular nums; sliders with a neon thumb; color swatches 20 px with a hex readout.

### Move 8 — Audio mixer on demand
- Hidden by default. Appears as a **bottom-right pop-over** (`M`, or automatically when the active scene has audio layers). Meters 6 px, track chips instead of dropdowns, master on the right. The 264 px it occupied returns to the timeline.

### Move 9 — Tokens, type, spacing (one language)
- Tokens (add to the `.posterract-editor-shell` block): `--surface-0: #05080b`, `--surface-1: rgba(234,255,243,.04)`, `--surface-2: rgba(234,255,243,.07)`, `--edge: rgba(234,255,243,.10)`, `--edge-strong: rgba(101,255,154,.28)`, `--neon: #65ff9a`, `--neon-soft: rgba(101,255,154,.18)`, `--cyan: #7cf7ff` (selection, measurements — secondary only), `--text: #eafff3`, `--text-dim: rgba(234,255,243,.62)`, `--text-faint: rgba(234,255,243,.40)`.
- Radii: panels 12, cards 10, controls 6, chips 4. Shadows: panels `0 24px 48px -24px rgba(0,0,0,.85)` + inset 1 px mint at 6%.
- Type scale: 11 (labels, uppercase, tracking .08em, `--text-dim`), 12 (secondary), 13 (body/controls), 15 (section titles), 20 (page-level). **Mono only for values**: time, zoom, coordinates, sizes, hex — never for buttons. "AI Generate" in mono is why the sidebar reads like a terminal.
- 8 px grid everywhere; minimum hit target 28 px.

### Move 10 — Motion system
- State changes 140 ms ease-out; panels 220 ms spring; camera moves 400 ms; hover lift 2 px; focus ring neon 2 px offset 2.
- Signature moments only: the Skill Deck fan, the Core breathing when connected, the playhead pulse on play, the Saved pill's green tick. Everything else is quiet. `prefers-reduced-motion` turns all of it into fades.

### Comfort (the part people feel but do not name)
- `⌘K` command palette (every command, every skill, every scene, recent assets).
- Panels remember size per project; double-click any divider to reset.
- Keyboard-first timeline: `J K L`, `I O`, `[ ]` trim, `,` `.` frame step, `S` skill, `T` peek, `M` mixer.
- Larger, fewer boxes: the screenshot has 9 bordered regions; the redesign has 4 (bar, rail+drawer, inspector, timeline) over one canvas.

### What stays exactly the same
Left side = assets and layers. Center = infinite canvas with scenes. Right = inspector. Bottom = timeline. Every existing feature, shortcut, and file-format behavior. The code panel, the agent connection, the BYO-key generation, exports, trash, version history.

### Build order
1. Tokens + type scale + command bar (Move 3, 9) — one day, no behavior change, everything looks 40% better.
2. Floating panels + timeline defaults + Peek (Move 1) — the canvas emphasis the founder asked for.
3. Scene title bars, glass slabs, telemetry corner, minimap (Move 2).
4. Skill Deck end to end (Part 1) — data, deck, chip, inspector, agent, provenance.
5. Rail + drawer, assets tree (Move 4).
6. Timeline lanes, captions lane, markers lane (Moves 5, 6).
7. Inspector card stack, version history sheet, mixer pop-over (Moves 7, 8).
8. Motion polish, reduced motion, ⌘K (Move 10, comfort).

Acceptance per phase: typecheck + eslint clean, `pnpm probe:bridge` green, a screenshot of each moved region, no regression in the shortcut sheet.
