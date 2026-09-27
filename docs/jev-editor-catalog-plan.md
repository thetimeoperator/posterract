# Make Jev able to operate the whole editor — build brief

Written 2026-09-19 for Opus 5. It follows `docs/voice-command-bar-plan.md` (the voice bar, already built). **Part A of that file — the repo rules — still applies in full:** the editor is SolidJS; never read out, log or use API keys; test only on the isolated `agenttest` instance and a scratch project; touch only named files; never scan the home folder; no commits unless told; report plainly, once.

Companion file: **`docs/editor-capability-inventory.md`** — a 739-line survey of everything the editor can do, with file:line for every function. Read it before starting; this brief cites it as *(inv. §X)*.

---

## 1. Why the bar "can't do anything" today — measured, not guessed

1. **Creating things is not on the list Jev chooses from.** `command-reading.ts` offers: the keyboard commands, `edit-properties`, `change-text`, `add-animation`, `add-effect`, `remove-animation`, `needs-writing`, `none`. "Add a circle" can only come back as "that isn't something the editor can do". The first brief never asked for creation — that gap is the brief's, not the build's.
2. **Commands take no parameters.** `edit.split` is the ⌘B function: it cuts only clips the playhead is inside. "Split at 5 seconds" cannot be said. With the playhead at the very start, split does nothing —
3. **— and the bar still says it worked.** `runCommand` (`engine/voice.tsx:343-361`) prints the command's `done` text even when `history.endGesture()` reports nothing changed.
4. **The 98 % score measured the wrong thing.** None of the 60 sentences in `scripts/command-corpus.json` contains "add", "create", "circle", "split", "trim", "align" or "captions". It scored the features that were built, not the things a person tries first.
5. **Jev is shown a thin scene, in raw numbers.** `describeElement` says "a rectangle, on screen 0–5 s, showing at the playhead" — no colour, size, position or layer. So "the red circle" and "the big title at the top" cannot resolve. TypeSafe's own notes say Jev compares numbers badly and should be handed named buckets.
6. **About 30 of ~180 properties can be spoken**, and whole areas have no words at all: timeline editing, align/distribute, outline, shadow, gradients, keyframes, transitions, captions, export options, assets, scenes, variables *(inv. §L.3 and "Biggest gaps")*.

## 2. The rule that decides everything

**Jev cannot work anything out. It can only pick from what it is shown.** Claude and Codex read the docs and invent the arguments; Jev cannot produce a word, a number or a plan. So "Jev understands the editor" has exactly one meaning: *every capability is written down as an entry Jev can pick, with every parameter turned into something pickable — and code that carries it out and reports whether it really happened.*

Six working principles:

1. **Words, not numbers.** Everything numeric about the scene is turned into named buckets by code before Jev sees it.
2. **Every parameter has a default**, so the short command works: "add a circle" → centre, medium, the Shape tool's own grey, at the playhead.
3. **Say a value, never a toggle.** "Hide the inspector" must not show it. Every on/off intent asks *which way*.
4. **Narrow before asking.** First which area, then which function inside it. Fewer, closer options are read more accurately than one list of 300.
5. **Nothing reports success unless something changed.**
6. **The test sentences are the product.** A function is "mapped" only when real phrasings of it pass.

## 3. This is a Jev-only build

**Jev is the only model in this plan.** Every phase is about Jev operating the editor: the catalog is what Jev picks from, the scene in words is what Jev reads, and the editor's own functions carry out what Jev picked. No other model is added.

The one thing to be straight about: Jev picks, it does not write. A request that needs new words invented ("write me a punchier headline") keeps doing what it does today — a note at the playhead for the connected agent. Everything a person can *do* in the editor is in scope; words the person speaks ("a title that says Summer Sale") are copied from the command by code, which is not writing.

LangChain is **not** used: it is a Python framework, the editor is TypeScript, and its Jev package is thin plumbing around the same request the bar already makes. Three habits are borrowed from it because they make Jev more dependable: anything risky asks first and **fails closed**, reading **fails open** when the service is down, and every decision is recorded.

## 3a. Additions after review (2026-09-19) — these override the sections they name

1. **Two things in one area (§4.4).** Inside a family, intents that combine ("make it red and bold", "move it left and make it bigger") are asked **yes/no each**, not as one choice. Only intents that exclude each other (which shape to add) stay a single choice.
2. **What the edit path can reach (§4.1).** `canvasApply` only addresses elements with a box — shapes, text, pictures, video, audio, groups, scenes (`resolveNode` → `isNode`). Animations, effects, outlines, shadows, keyframe tracks, markers and caption lines are changed through the `DocumentEditor` directly, as `applyReading` already does for "remove the fade". A sentence with several intents lands as **one** undo step: `canvasApply` gets an option to run inside the caller's gesture instead of opening its own.
3. **"It" is what just happened (§4.2).** After a command runs, the bar selects what it made or changed. "Add a circle" then "make it red" works through the selection, and the person sees what changed.
4. **New things follow the tools (§5.1).** A shape or text added by voice gets exactly what the Component and Text tools give it — including its timing. Only "here", "now" or a spoken time starts it at a time.
5. **The scene as the person sees it (§4.3).** Each line carries the layer name exactly as the timeline shows it, and for neighbours "just below / above / left of / right of *<name>*" — so "the line under the title" resolves.
6. **Missing functions (§5).** `arrange.replace-media` — "replace this clip with the drone shot" (`editProperty('src', …)`, `source.tsx:89`). `scene.resize` — "make this video vertical / square" (the 22 presets, `layout-presets.ts:18`). Freeze frame and reverse go in §5.11: the editor has neither.
7. **Tests that can be trusted (§6).** A test sentence is never one of the `examples` Jev is shown. Each area also gets spoken sentences — synthesized with the Mac's own voices, sent through Groq, then Jev — so numbers as words ("nine"), homophones and punctuation are covered. A result reached by another route counts as right (hiding by the Hide command or by setting `hidden`).
8. **Checked, not assumed (§4.4).** One call settles whether OpenRouter passes `{what, notFor, examples}` criteria through; if not, they are folded into the option's text.
9. **The speech model hears the editor's words (§4.2).** The Groq prompt is built from the catalog's words and the scene's names.
10. **Assets (§4.2).** The library is narrowed by the words said before Jev is asked which asset is meant.

---

## 4. Architecture

### 4.1 The catalog — `apps/editor-sandbox/src/context/agent-api/intents/`

```ts
// types.ts
export type SlotKind = 'element' | 'elements' | 'choice' | 'number' | 'amount' | 'text' | 'when' | 'spot' | 'color' | 'asset' | 'direction' | 'onoff';

export type Slot = {
  name: string;
  kind: SlotKind;
  ask: string;                                   // the literal question put to Jev
  options?: Record<string, OptionText>;          // for 'choice'
  units?: Array<'px' | '%' | 's' | 'frames' | 'deg' | 'x' | 'db'>;   // for 'number'
  required?: boolean;                            // default false: every slot has a default
  fallback: (ctx: IntentContext) => unknown;     // what is used when the person did not say
};

export type OptionText = { what: string; notFor?: string; examples: string[] };

export type Outcome = { changed: boolean; receipt: string; why?: string; fix?: string };

export type Intent = {
  id: string;                                    // 'time.split'
  family: Family;
  text: OptionText;                              // how Jev sees this intent
  when?: (ctx: IntentContext) => true | string;  // true, or the plain reason it cannot run now
  slots: Slot[];
  risk: 'safe' | 'confirm';                      // 'confirm': deletes, anything that spends money, restores
  run: (ctx: IntentContext, slots: Record<string, unknown>) => Promise<Outcome> | Outcome;
};

export type Family = 'create' | 'time' | 'arrange' | 'style' | 'motion' | 'sound' | 'captions' | 'view' | 'project' | 'generate';
```

- One file per family (`create.ts`, `time.ts`, …), `index.ts` for the registry.
- **Generated where possible.** Property intents are built from `@posterract/composition/vocabulary.json` (tags, props, enum values, per-tag applicability). Today's `COMMANDS` become intents with no slots through one adapter, so nothing already working is lost.
- **Hand-written where it must be:** `text` (what / notFor / examples), defaults, and the `run` functions.
- `run` goes through `canvasApply` (`context/agent-api/canvas.ts:287`) or an engine function, inside one history gesture, and builds its `Outcome` from what actually changed (`history.endGesture()` returns that).
- **`coverage.test.ts` — the promise that "every function is mapped" stays true.** It fails when any of these has neither an intent nor an entry in `NOT_VOICEABLE` with a written reason: a vocabulary tag, a vocabulary prop, an enum value, a public `DocumentEditor` method, an exported engine action, an entry in `COMMANDS`.

### 4.2 Slots — `intents/slots/*.ts`, one resolver per kind, shared by every intent

| Kind | How it is filled |
|---|---|
| `element`, `elements` | a choice over the scene's elements described in words (§4.3), plus `selection` ("this", "it", "these") and **`last`** — what the previous command made or changed ("add a circle" → "make it red") |
| `choice` | a choice over the slot's options |
| `number` | found **by code** (`findLiterals` in `command-reading.ts:235`, extended to timecodes "0:12", spelled numbers "two seconds", "half", "double", "a quarter"); Jev only says which slot a number belongs to |
| `amount` | score: a little / noticeably / a lot → steps fixed in code |
| `text` | quoted words, or the words after "says / saying / that reads / called / named / to"; failing that, the existing `text_start` question |
| `when` | a choice: `playhead` ("here", "now"), `start`, `end`, `spoken-time` (from a literal), `marker:<name>`, `when:<element> starts`, `when:<element> ends` |
| `spot` | the 11 `place` values, plus `where-it-is` |
| `color` | named colours — widen `COLOR_NAMES` from 13 to about 40, plus `lighter`/`darker` steps, a spoken hex, and `same-as:<element>` |
| `asset` | a choice over the project's library: name, kind, length — *(inv. §A.5)*. The resolver has no idea of an asset today. |
| `direction` | left / right / up / down / earlier / later / clockwise / counter-clockwise |
| `onoff` | one yes/no asking which way |

### 4.3 The scene in words — `intents/describe-scene.ts`

Replace `describeElement` (`command-reading.ts:293`). Each element becomes a line like:

`#t3 — the text "WILD STORM": large, white, top centre, in front of everything, on screen for the whole video, under the playhead, fades in`

All computed by code from `Computed` boxes and authored props:

- **What it is:** the authored tag as a plain noun. An `ellipse` whose width ≈ height is "a circle"; a `rect` that is square is "a square"; a `rect` holding a `videoPaint`/`imagePaint` is "the video / the picture *<file name>*" *(inv. §A.5)*.
- **Colour name** — nearest named colour to its fill or text colour. Never a hex.
- **Size** — tiny / small / medium / large / fills the frame, by share of the scene's area.
- **Where** — a 3×3 grid (top left … bottom right) plus "off screen".
- **Layer** — "in front of everything", "behind everything", or "in front of *<name>*".
- **Order among its kind** — "the 2nd video clip", counted in time order.
- **When** — "under the playhead", "earlier", "later", "the whole video", "first clip", "last clip".
- **Flags** — hidden, locked, muted, "fades in", "slides out", inside the group/scene *<name>*.

The numeric `state` (`stateOf`, `command-reading.ts:313`) keeps the numbers for code to use, but no question may depend on Jev comparing them.

### 4.4 Reading in two steps — `intents/read.ts`

0. **No model:** exact and alias matching, as today.
1. **Which areas?** One small request: a yes/no per family ("Does the command ask to add something new?" …), so a sentence may touch two areas, plus `needs-writing` (the existing note for the connected agent) and `nonsense`. State = the command and a one-line summary of the selection. No element list.
2. **Inside each chosen area, in parallel:** the intent (a choice over that family only, using `what / notFor / examples`), that family's slot questions, and the target — with only the scene detail that family needs.
3. Combine into a `Reading`. The lanes stay: apply ≥ 0.80 · chips 0.50–0.80 · numbered choices below · `risk: 'confirm'` always asks.

**This must be proven, not assumed.** Run the corpus through the current single request and through the two-step reading, and keep whichever is more accurate *per family*. Likewise test plain-sentence criteria against `{what, notFor, examples}` objects — TypeSafe's docs accept structured criteria, but whether OpenRouter's alpha endpoint passes them through is unverified.

### 4.5 Outcomes

`runCommand` (`engine/voice.tsx:343`) and every `run` return an `Outcome`. When `changed` is false the bar shows `why` and `fix`, never the success line:

> Nothing to split — the playhead isn't over a clip. Move it onto the clip, or say "split at 5 seconds".

### 4.6 More than one thing in a sentence

- Two areas in one sentence ("add a circle and make it red"): both run, in the order spoken; what the first made becomes the target of the second (`last`).
- "…, then …" is cut in code and read one piece after another.
- Everything lands as **one** undo step.

### 4.7 When the service is down

- Reading **fails open**: if OpenRouter does not answer within 4 s, exact commands still work and the bar says so plainly. (The decisions endpoint sits on an `/api/alpha/` path.)
- Gates **fail closed**: a `confirm` intent never runs without the person's yes.

### 4.8 The record — `<project>/.posterract/voice-log.jsonl`

One line per command: the words, the reading (intent, slots, confidence), the lane, whether it ran, whether it was undone within 15 s, which chip was corrected and to what. **Words only, never audio, never keys; it stays on the machine.** `scripts/voice-log-to-corpus.mjs` turns undone and corrected commands into new test sentences. This is how it keeps improving after launch.

---

## 5. THE LIST — every function to map

**Today:** ✓ works · ◐ partly · ✗ missing. "NEW" = a function to write, usually by lifting logic out of a UI handler so the tool and the bar share one path *(inv. "Capabilities with no programmatic entry point")*.

### 5.1 Create — nothing here can be said today

| Intent | People say | Slots (default) | Runs | Today |
|---|---|---|---|---|
| `create.shape` | "add a circle", "put a big red star top right" | kind: rectangle, square, ellipse, circle, triangle, diamond, pentagon, hexagon, star, arrow · spot (centre) · size bucket (the tool's 300 × 300) · colour (`#E0E0E0`) · when (playhead) | NEW `createShape`, lifted from `draw-overlay.tsx:164`, using `ShapeElement` `shapes.tsx:89` and `pointsFor` `:71`; circle/square = equal sides | ✗ |
| `create.text` | "add a title that says Summer Sale" | words ("Text") · spot · size bucket (scene height ÷ 22.5, as the Text tool) · colour (`#FFFFFF`) · when | NEW `createText`, lifted from `draw-overlay.tsx:180-199` | ✗ |
| `create.scene` | "new scene", "add a YouTube scene" | format: the 22 presets in `lib/layout-presets.ts:18` (1080 × 1920) · name | `createScene` `new-scene.tsx:63` + `findEmptyPlacement` `placement.ts:69` | ✗ |
| `create.from-asset` | "add the storm video", "put the logo in the corner", "add the music" | asset · spot · when | `insertAsset` `insert-asset.tsx:33` | ✗ |
| `create.scene-from-asset` | "make a scene from the storm clip" | asset | `insertMediaAsScenes` `new-scene.tsx:133` | ✗ |
| `create.captions` | "add captions", "caption this" | preset (classic) · position | NEW `captionScene`, lifted from `cue-editor.tsx` ~160-215 (transcribe → group words → cues). Uses the Groq key. | ✗ |
| `create.marker` | "marker here called drop", "marker at 5 seconds" | when · name | `addMarkerAtPlayhead` `markers.tsx:54` + NEW `addMarkerAt(frame, name)` | ◐ |
| `create.mask` | "mask this with a rectangle" | target | NEW, lifted from `masks.tsx:48` | ✗ |
| `create.adjustment-layer` | "add an adjustment layer with a blur" | filter | `canvasApply` create `<adjustmentLayer>` + `<effect>` | ✗ |
| group / sequence / scene from the selection | | | `edit.group`, `edit.wrap-sequence`, `edit.wrap-scene` | ✓ |

### 5.2 Time and the timeline

| Intent | People say | Slots | Runs | Today |
|---|---|---|---|---|
| `time.split` | "split", "cut here", "split at 5 seconds", "cut at the marker" | when (playhead) · target (clips under that moment) | seek, then `splitAtPlayhead` `split.tsx:92`; outcome = the halves it returns | ◐ no time, false success |
| `time.trim-start` | "trim the start to here", "cut off the first 2 seconds" | target · when | `trimIn` `timing.ts:92` | ✗ |
| `time.trim-end` | "end it here", "cut everything after 8 seconds" | target · when | `trimOut` `timing.ts:108` | ✗ |
| `time.set-length` | "make it 3 seconds long" | target · seconds | `trimOut` at start + length | ✗ |
| `time.move-to` | "move it to 10 seconds", "start it when the title ends", "put it right after the intro" | target · when | `moveEntityTo` `timing.ts:128` | ◐ |
| `time.shift` | "half a second later", "ten frames earlier" | target · number or amount · earlier/later | `nudgeSelectionInTime` `transport.ts:179` | ◐ |
| `time.fill-scene` | "make it last the whole video" | target | `editTime` `timing.ts:65` | ✗ |
| `time.slip` / `time.slide` | "slip the footage one second" | target · number | `slipEntity` `:154`, `slideEntity` `:192` — reachable only by dragging today | ✗ |
| `time.speed` | "twice as fast", "half speed", "normal speed" | target · rate (number or half/normal/double) | `playbackRate` | ◐ |
| `time.transition` | "dissolve into the next clip", "fade to black between these" | target · type (5, `transition-types.ts:16`) · seconds (1) | `editProperty('transition', …)` `transition.tsx:73`. Only for a clip inside a sequence — otherwise say so and offer to wrap it. | ✗ |
| `time.go-to` | "go to 5 seconds", "go to the marker drop", "back 3 seconds", "next cut" | when / number | `canvasSeek` `canvas.ts:92`, `seekToStart/End`, `seekToCut`, `seekBy` | ◐ |
| `time.play`, `time.pause` | "play", "pause", "stop" | — | `togglePlayback`, reading the playing flag first | ◐ toggle |
| `time.range` | "export only 2 to 8 seconds", "mark in here", "clear the range" | from · to | `editWorkarea` `timing.ts:76` | ◐ |
| `time.marker-remove / rename / go-to` | | marker | `sceneMarkers` `markers.tsx:21` | ✗ |
| `time.lock`, `time.unlock` | "lock this layer" | target · onoff | `locked` | ✗ |
| hide/show, mute/unmute | | | already ask which way | ✓ |
| `time.snapping` | "turn snapping off" | onoff | `timeline/snapping.ts:49` — a toggle today | ◐ |
| ripple delete, wrap/unwrap sequence, timeline zoom | | | commands | ✓ |
| `timeline.detail` | "show the animation rows" | level | `setTimelineDetail` `timeline/detail.ts:29` | ✗ |

### 5.3 Arrange

| Intent | People say | Slots | Runs | Today |
|---|---|---|---|---|
| place · move by direction · exact x/y | | | | ✓ |
| `arrange.next-to` | "put the logo under the title", "centre it on the circle" | target · anchor element · relation (above, below, left of, right of, centred on, same place) · gap | NEW — boxes from `Computed`, then x/y | ✗ |
| `arrange.align` | "align these left", "line them up along the top" | targets · how (6, `align.ts:34`) | `alignSelection` `align.ts:105`; one element → against the frame, computed. **Today "align left" is misread as text alignment.** | ✗ |
| `arrange.distribute` | "space these out evenly" | axis | `distributeSelection` `align.ts:139` | ✗ |
| `arrange.center` | "centre it horizontally" | both / x / y | computed | ◐ |
| `arrange.fill-frame` | "fill the screen", "half the width of the screen", "same size as the title" | target · mode | NEW | ✗ |
| size by number · bigger/smaller · rotate by number | | | | ✓ |
| rotate, named | "upside down", "straighten it", "quarter turn right" | | fixed angles | ✗ |
| `arrange.keep-ratio` | "lock the proportions" | onoff | `keepAspectRatio` | ✗ |
| `arrange.layer` | "one step forward", "behind the title" | target · step or anchor | `editor.reparent` `editor.ts:964` / `canvasMove` `canvas.ts:258` | ◐ front/back only |
| `arrange.into` | "move this into the second scene", "put it in the group" | target · container | `canvasMove` | ✗ |
| duplicate | "duplicate it three times" | number | loop | ◐ |
| `arrange.change-shape` | "make it a star" | kind (8) | `changeShape` `shapes.tsx:152` | ✗ |
| `arrange.inset`, offsets, `scaleX/Y` | "20 pixels from the edge" | number | props | ✗ |
| delete (always asks), group/ungroup, rename | | | | ✓ |
| `arrange.flip` | "flip it" | axis | **Blocked.** Flip is a trait with no spelling in the file (`rotate-row.tsx:30`) and is lost on reload. First test whether `scaleX = -1` draws as a flip; if not, the vocabulary needs a prop before this is offered. | ✗ |

### 5.4 Style

| Intent | People say | Runs | Today |
|---|---|---|---|
| colour | "make it red" | widen the palette; add lighter/darker and "same colour as the title" | ◐ 13 names |
| `style.gradient` | "green to blue gradient", "radial gradient" | NEW `setFill`, lifted from `fill-picker.tsx:113` + `gradient-picker.tsx:122` | ✗ |
| `style.fill-with-media` | "fill the circle with the storm video" | image/video paint through `setFill` (asset slot) | ✗ |
| `style.outline` | "add a white outline", "thicker", "remove the outline" | `<stroke>` — defaults `strokes.tsx:57`, props `stroke-inspector.tsx:80-102` | ✗ |
| `style.shadow` | "add a drop shadow", "softer shadow" | `<shadow>` — `shadows.tsx:64`, `shadow-inspector.tsx:62-78` | ✗ |
| filters | add ✓ · strength ✓ · "remove the blur", "remove all filters" | | ◐ |
| opacity, blend mode, rounded corners | ✓ · "round only the top corners" (four per-corner props) | | ◐ |
| `style.background` | "make the background black", "make the canvas grey" | scene `fill`; stage `background` `background.tsx:37` | ◐ |
| text: font, size, weight, italic, spacing, line height, align, case, underline, the words | | | ✓ |
| text baseline · auto-size or fixed box | | `text.tsx:334`, `:171` | ✗ |
| `style.word` | "make the word STORM green and bold" | NEW — find the word in the element's text in code → `<textRange start end …>`. **There is no UI for this at all; voice would be the only way to do it.** | ✗ |
| fit (cover / contain / fill) | | | ✓ |
| `style.cut-out-background`, `style.upscale` | "remove the background" | vocabulary props `removeBackground`, `upscale`. **Find out what they need to run and whether they cost money before offering them;** if they cost, `risk: 'confirm'`. | ✗ |
| `style.copy-look` | "make it look like the title" | NEW — copy style props and paints. Later. | ✗ |

### 5.5 Motion

| Intent | People say | Runs | Today |
|---|---|---|---|
| add an entrance or exit | 14 types · in/out · 8 easings · seconds ✓ — add distance, amount, delay | | ◐ |
| `motion.change` | "make the entrance slower", "change it to a slide from the left" | props on the animation entity (`animations.tsx:282-324`) | check |
| remove one / remove all | | | ◐ |
| `motion.stagger` | "stagger these by point two seconds" | group prop `stagger` — no UI exists; wrap in a group first when needed | ✗ |
| `motion.keyframe-add` | "keyframe the position here" | property (25) · when — `writeKeyframe` / `toggleKeyframe` `keyframes.tsx:81/:112` | ✗ |
| `motion.keyframe-remove` | "remove the rotation keyframes" | `removeKeyframeTrack` `:140` | ✗ |
| `motion.loop` | "loop it", "make it go back and forth" | `<keyframeTrack loop>` repeat / pingpong — no UI exists | ✗ |
| `motion.bake` | "bake the position" | property (7, `node.tsx:62`) — `bakeToKeyframes` `bake.tsx:85` | ✗ |
| keyframe easing | | `interpolation.tsx:130` | ✗ |

Once a track exists, moving the element writes its keyframe automatically (`syncKeyframe`). So "keyframe the position" → "go to 3 seconds" → "move it right" is three fast commands that make an animation — all Jev.

### 5.6 Sound

| Intent | People say | Runs | Today |
|---|---|---|---|
| volume | number (dB) ✓ · louder / quieter / half volume | | ◐ |
| mute / unmute | | | ✓ |
| `sound.fade` | "fade the music out" | the `gain` animation. **Code, not Jev, picks `gain` for a sound and `fade` for a picture**, from the target's kind. | ◐ |
| `sound.duck` | "lower the music when he talks" | `<duck target by amount attack release>` — no UI exists | ✗ |
| scene volume | | scene `volume` | ✗ |
| `sound.add-soundtrack` | | `addAudio` — find out what it costs first; `risk: 'confirm'` | ✗ |

### 5.7 Captions

| Intent | People say | Runs | Today |
|---|---|---|---|
| add captions | | see `create.captions` | ✗ |
| style · position | 13 presets · top / centre / bottom | | ✓ |
| `captions.colors` | "make the captions yellow" | colours are positional per preset (`caption-types.ts:30-79`) → NEW: map a spoken role to the right slot | ✗ |
| `captions.unpack` | "let me edit the captions" | NEW, lifted from `cue-editor.tsx:63` | ✗ |
| `captions.fix` | "change the caption at 5 seconds to say …" | when · words — `editText` on the cue under that moment | ✗ |
| `captions.export` | "export subtitles as SRT" | NEW, lifted from `cue-editor.tsx:80` (srt / vtt) | ✗ |

### 5.8 Select, move around, look

| Intent | People say | Runs | Today |
|---|---|---|---|
| `select.these` | "select the title", "select all the text", "select everything after the playhead", "add the logo to the selection" | `editor.select(entities, { extend })` `editor.ts:436` | ◐ |
| select all / parent / children / nothing | | | ✓ |
| `scene.go-to` | "go to the intro scene", "next scene" | `editor.activate` `editor.ts:466` | ✗ |
| zoom in / out / fit / selection / actual size | ✓ · "zoom to 200 percent" → `zoomTo` `camera.ts:46` | | ◐ |
| `view.show-in-timeline` | | `revealInTimeline` `reveal-timeline.ts:12` | ✗ |
| workspaces, panels | ✓ but toggles — make them say a value | | ◐ |
| inspector tab · mixer · timeline detail | | `layout.tsx:71`, `:88`; `detail.ts:29` | ✗ |
| `view.theme` | "switch to Noir" | NEW setter. The code calls the second theme `frost`, the label says "Glass" — pick one word. | ◐ |
| tools | ✓ · "draw stars" → `setDrawnShape` `shapes.tsx:64` | | ◐ |

### 5.9 Project

| Intent | People say | Runs | Today |
|---|---|---|---|
| export | ✓ · "export in 4K", "export for TikTok", "as WebM", "at 60 frames" | preset (9) · resolution (4) · format (4) · codec (5) · frame rate (8) — `export-templates.ts:36`; `exportScene` is a Solid context method (`context/export.tsx:45`), so pass it arguments through `registerCommand`; saved with `ProjectConfig.setExport` `project-config.ts:186` | ◐ no options |
| `export.frame` | "save this frame as an image" | `exportCurrentFrame` `export.tsx:169` | ✗ |
| undo / redo / again | ✓ · "undo three times" | | ◐ |
| `history.restore` | "go back to the version from before" | lift from `version-history.tsx:57`; `risk: 'confirm'` | ✗ |
| `project.rename` | "rename the project to …" | lift from `command-bar.tsx:47` | ✗ |
| `assets.import` | "import a file" | opens the picker — `pickAndImport` (`asset-actions.ts`) | ✗ |
| asset rename / replace / delete | | lift from `asset-item.tsx`; delete asks | ✗ |
| `variables.set` | "set the headline to Summer Sale", "set the accent colour to green" | a choice over `getInspectEntries(world)` (`inspect.ts`); value by the variable's own type — `editor.editVariable` `editor.ts:384`. **Very useful for template videos.** | ✗ |
| `skills.pick` | "make this a captioned clip" | a choice over the skill cards — `installSkill` `skill-deck.tsx:53` | ✗ |
| open exports library / agent / AI Generate | | | ✓ |

### 5.10 Generate — spends the person's own provider credit, so **always** `risk: 'confirm'`

| Intent | People say | Slots | Runs |
|---|---|---|---|
| `generate.image` | "generate an image of a stormy sky, vertical" | the words after "of" · shape (5) · 1K / 2K | the `ai.image` handler (`agent-api/generate.ts`) + `insertGeneration` `insert-generation.tsx:33` |
| `generate.video` | "generate a 6-second clip of …" | words · shape · seconds 4–15 · quality · reference = the selected picture | `ai.video` |
| `generate.voice` | "say 'welcome back' in the deep voice" | words · voice (`FISH_VOICES`, `generate-panel.tsx:62`) | `ai.voice` |

### 5.11 Not offered — and the reason the bar gives

| What | Why |
|---|---|
| Drawing a path; marquee selection | they need pointing, not words |
| Skew, anchor point, constraints, clip contents, solo | kept only in memory; nothing in the file records them, so they are lost on reload. They need a spelling in the vocabulary before they are offered *(inv. §D, §C.3)* |
| Crop | the editor has none — say so, and offer fit/fill or a mask |
| Panning the canvas | no function exists |
| HTML, shader, surface and diagram elements | these are written as code — work for the connected agent |
| Dragging gestures | replaced by the intents above |

---

## 6. Build order — stop and report after each phase

### Phase 0 — honest results, for every command (small)

`runCommand` and every existing action return an `Outcome` (§4.5). Nothing in the bar prints a success line unless something actually changed; when nothing changed, it says why and what to do. This covers every command — the ones that exist and every one added later.

**Done when** no command, run in a situation where it cannot apply, reports success.

The goal of this whole brief is coverage of the entire editor, not any particular command. The two sentences quoted in §1 are only how the cause was found.

### Phase 1 — the catalog's bones (medium)

`intents/types.ts`, the registry, the adapter over `COMMANDS`, every slot resolver in §4.2, `describe-scene.ts`, `coverage.test.ts`, `NOT_VOICEABLE`, the voice log. Move the existing actions (`edit-properties`, `change-text`, `add/remove-animation`, `add-effect`) into intents **without changing what they do** — the 60-sentence corpus must still pass.

### Phase 2 — the two-step reading (medium)

Build §4.4. Run the corpus both ways. Report accuracy per family for single-request vs two-step, and plain vs structured criteria. Keep the winner for each family.

### Phase 3 — fill the areas (large)

Order: **Create → Time → Arrange → Style → Motion → Sound → Captions → View → Project → Generate.** For each area:

1. Lift any UI-only logic into an engine function the UI also calls, so the tool and the bar cannot drift apart.
2. Write the intents, with 5–10 `examples` each in the way people actually speak.
3. Add 40–80 corpus sentences. Include speech-to-text style: no punctuation, "to" for "two", "for" for "four", run-ons, filler words.
4. Switch the area on only when it passes **≥ 90 % right and ≤ 1 % wrong-but-confident**. Wrong-but-confident is what destroys trust; weight it above everything else.

Corpus runs use the founder's OpenRouter key — a few cents each. **He runs them, or tells you explicitly to.**

### Phase 4 — the loop (small)

`voice-log-to-corpus.mjs`; refresh the first-run examples with one from each area; one docs page listing what can be said, **generated from the catalog** so it cannot go stale.

---

## 7. What to report after each phase

1. What the founder can now say that he could not before — three or four example sentences.
2. Corpus results for that area: right, wrong-but-confident, p50 time.
3. Anything blocked, and on what.
4. Nothing else.

## 8. The one decision that is the founder's

The blocked items — flip, and the memory-only transforms in §5.11 — need small additions to the editor's file format before Jev can be offered them. Do them, or leave them unsaid?
