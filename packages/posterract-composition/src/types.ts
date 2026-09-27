/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX as SolidJSX } from "solid-js";
import type { Entity } from "koota";
import type { AssetRef } from "./generate.js";

/**
 * Composition-relative time: seconds (number), frames ("30f"), a
 * "MM:SS" / "HH:MM:SS" clock string, or musical time — beats ("4b") and bars
 * ("2bar") at the scene's `bpm` and `meter`. The canonical internal unit is
 * frames at 30 fps; all formats are converted on import. Values may be
 * negative.
 *
 * Musical time is a length, like every other form: "4b" is four beats long,
 * so `start="4b"` is four beats into the parent's timeline and a keyframe at
 * `time="1b"` is one beat into its clip. Trim the music so its first downbeat
 * sits at 0 (`posterract media beats` reports where it is) and the beats of
 * the song and the beats of the timeline are the same beats.
 */
export type Time = number | `${number}f` | `${string}:${string}` | `${number}b` | `${number}bar`;

export type Fit = "cover" | "contain" | "fill";

/** How a stroke turns a corner: the canvas `lineJoin` values. */
export type StrokeJoin = "miter" | "round" | "bevel";

/** How a stroke ends an open path: the canvas `lineCap` values. */
export type StrokeCap = "butt" | "round" | "square";

/**
 * How an element composites over what is below it: the canvas
 * `globalCompositeOperation` blend modes, camelCase. Default "sourceOver".
 */
export type BlendMode =
  | "sourceOver"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "colorDodge"
  | "colorBurn"
  | "hardLight"
  | "softLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/**
 * An `<effect>`'s filter, applied to the parent's rendered pixels. The first
 * eight are the CSS filter functions: `blur` takes a radius in px, `hueRotate`
 * degrees, the rest an amount 0–1. The finishing effects work on the whole
 * rendered layer, so one on a `<scene>` finishes everything in it:
 *
 * - `grain` — film grain, a fresh pattern every frame. `value` 0–1 is how
 *   strong, `size` the grain in px (default 1.5).
 * - `vignette` — darkens toward the edges. `value` 0–1, `size` 0–1 how far in
 *   the darkening reaches (default 0.5).
 * - `glow` — a bloom of the layer's own light. `value` how strong (0–2),
 *   `size` its radius in px (default 24).
 * - `chromaticAberration` — red and blue pulled apart, the colour fringe of a
 *   cheap lens. `value` the offset in px.
 * - `directionalBlur` — smears along one direction, the streak of a whip.
 *   `value` the length in px, `angle` the direction in degrees (0 = across).
 */
export type EffectType =
  | "blur"
  | "brightness"
  | "contrast"
  | "grayscale"
  | "hueRotate"
  | "invert"
  | "saturate"
  | "sepia"
  | "grain"
  | "vignette"
  | "glow"
  | "chromaticAberration"
  | "directionalBlur";

/**
 * Easing for the segment from a keyframe to the next one: a named preset or
 * an explicit descriptor. `cubicBezier(x1,y1,x2,y2)` takes CSS-style control
 * points, `spring(bounce,duration)` a 0–1 bounce and a duration in ms,
 * `steps(n)` holds n discrete values.
 */
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "gentle"
  | "snappy"
  | "bouncy"
  | "strong"
  | `cubicBezier(${string})`
  | `spring(${string})`
  | `steps(${string})`;

/**
 * The props a `<keyframeTrack>` can drive, by name. Whose prop is the
 * track's holder's: `x` under a `<rect>` is the rect's, `width` under a
 * `<stroke>` the line width, `value` under an `<effect>` its amount,
 * `color`/`opacity` under a paint the paint's.
 */
export type AnimatableProperty =
  | "x"
  | "y"
  | "offsetX"
  | "offsetY"
  | "width"
  | "height"
  | "rotation"
  /** 3D tilt, degrees — see `TransformProps`. `perspective` is further down. */
  | "rotationX"
  | "rotationY"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "opacity"
  | "cornerRadius"
  | "cornerRadiusTopLeft"
  | "cornerRadiusTopRight"
  | "cornerRadiusBottomRight"
  | "cornerRadiusBottomLeft"
  | "volume"
  | "color"
  | "offset"
  | "blur"
  | "value"
  /** How far a `<path>` has blended toward its `morphTo`, 0–1. */
  | "morph"
  /** Which fraction of a vector figure is drawn — see `TrimProps`. */
  | "trimStart"
  | "trimEnd"
  | "trimOffset"
  /**
   * A diagram element's draw-on reveal, 0–1 and clamped to it. Only diagram
   * elements have it: `<diagramArrow>` draws its path (and its head) up to
   * the value, `<diagramPlot>` draws that fraction of its points. A track
   * from 0 to 1 is the native DrawSVG-style line reveal.
   */
  | "progress"
  /**
   * Shape keyframes: each keyframe's `value` is path data, and the figure
   * blends from one to the next — any shape into any shape. `d` on a
   * `<path>`, `path` on a `<text>` laid along a path.
   */
  | "d"
  | "path"
  /** A `<text>` on a path: how far along it the text sits, and how far off it. */
  | "pathOffset"
  | "pathShift"
  /** An `<effect>`'s second and third numbers — see `EffectType`. */
  | "size"
  | "angle"
  /** A `<repeater>`'s numbers — see `RepeaterProps`. */
  | "count"
  | "spacing"
  | "radius"
  | "tube"
  | "ripple"
  | "rippleFrequency"
  | "ripplePhase"
  | "rippleCenterX"
  | "rippleCenterY"
  | "tiltX"
  | "tiltY"
  | "roll"
  | "zoom"
  /** A `<repeater>`'s camera distance, or the camera any element's 3D tilt is seen through. */
  | "perspective"
  | "cameraZ"
  | "depthFade"
  /**
   * A knob of a `<surface>` or `<html>` (`knob.tilt` drives `knobs.tilt`), or
   * a uniform of a `<shaderPaint>` (`uniform.amount`). Canvas code reads the
   * knob; the timeline drives it.
   */
  | `knob.${string}`
  | `uniform.${string}`;

/**
 * Transition styles — the editor's transition inspector options.
 *
 * - `iris` — the next clip opens in a circle growing from the middle.
 * - `shapeWipe` — the same through any shape: `shape` is its path data.
 * - `wipeLeft` / `wipeRight` / `wipeUp` / `wipeDown` — a hard edge sweeps
 *   the next clip in, travelling that way.
 * - `zoomThrough` — the camera pushes into the outgoing clip and comes out
 *   of the incoming one.
 * - `whipLeft` / `whipRight` / `whipUp` / `whipDown` — a whip pan: both clips
 *   rush past, smeared along the move.
 */
export type TransitionType =
  | "dissolve"
  | "slideFromRight"
  | "slideFromLeft"
  | "fadeToBlack"
  | "fadeToWhite"
  | "iris"
  | "shapeWipe"
  | "wipeLeft"
  | "wipeRight"
  | "wipeUp"
  | "wipeDown"
  | "zoomThrough"
  | "whipLeft"
  | "whipRight"
  | "whipUp"
  | "whipDown";

/** The `transition` prop's value — see `SequenceItemProps["transition"]`. */
export type TransitionSpec = {
  /** Transition style. Default "dissolve". */
  type?: TransitionType;
  /** Length of the transition, centered on the cut. Any `Time` format. Default 1 second. */
  duration?: Time;
  /**
   * For `shapeWipe`: the shape the next clip opens through, as path data in a
   * 100×100 box. It grows from the middle of the frame until it covers it.
   * Default a circle.
   */
  shape?: string;
};

/**
 * Preset animation styles — the editor's animations inspector options.
 * "appearWord" / "appearChar" / "scramble" apply only to text elements;
 * "gain" ramps audio and has no visual effect.
 */
export type AnimationType =
  | "fade"
  | "gain"
  | "grow"
  | "shrink"
  | "blur"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "spin"
  | "twist"
  | "appearWord"
  | "appearChar"
  | "scramble";

/** How glyphs are cased when drawn, whatever the text says. Default "original". */
export type TextCase = "original" | "upper" | "lower";

/** Caption style presets — the editor's caption inspector presets. */
export type CaptionPreset =
  | "classic"
  | "cascade"
  | "spotlight"
  | "whisper"
  | "paper"
  | "guinea"
  | "stark"
  | "pop"
  | "karaoke"
  | "typewriter"
  | "banner"
  | "punch"
  | "marquee";

// ── Shared prop groups ──────────────────────────────────────────────────────
//
// Props several elements share, each defined once so its type and doc are the
// same wherever it appears. Element prop types compose these and add what is
// theirs alone. Any prop can be animated by a `<keyframeTrack>` child naming
// it (see `AnimatableProperty`); none takes keyframes inline.

/** What every element the editor can point at carries. */
type IdentityProps = {
  /** Human-readable node name. */
  name?: string;
  /**
   * Protects the element in the editor: a locked layer cannot be dragged on
   * the timeline and is left alone by a delete — a person's or an agent's.
   * Set from the timeline's lock toggle. Part of the document, so a lock set
   * by one author holds for the other; nothing rendered or exported depends
   * on it.
   */
  locked?: boolean;
  /**
   * Whether the editor has this element selected.
   *
   * @deprecated Editor view state, not part of the composition: nothing
   * rendered or exported depends on it. The editor no longer writes it into
   * the source — it is remembered in `.posterract/view.json` beside the
   * project, and lifted out of an older source the next time that is opened.
   * Still accepted so such a source keeps compiling; do not author it.
   */
  selected?: boolean;
  /**
   * Height of the element's row in the timeline, px.
   *
   * @deprecated Editor view state, as `selected` is; see there.
   */
  clipHeight?: number;
  /**
   * Whether the timeline shows this element's keyframe rows below its clip.
   *
   * @deprecated Editor view state, as `selected` is; see there.
   */
  expanded?: boolean;
};

type PositionProps = {
  /** Position relative to the parent, px. Defaults to 0. */
  x?: number;
  y?: number;
};

/**
 * Where an element belongs in the frame, by name: the nine points of the frame
 * (its corners, the middles of its edges, its centre) and the two thirds lines
 * a title or a caption usually sits on.
 */
export type Placement =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right"
  | "upper-third"
  | "lower-third";

type PlacementProps = {
  /**
   * Where the element belongs in its scene's frame, instead of `x`/`y`:
   * `place="bottom-right"` puts its bottom right corner on the frame's,
   * `place="lower-third"` centres it on the line two thirds of the way down.
   * Worked out from the element's size as it is on each frame, so a text with
   * no `width` is placed by what it says. While it is set, `x` and `y` are not
   * read; move the element from there with `offsetX`/`offsetY`, which are also
   * what the slide animations drive. Dragging the element in the editor
   * replaces the placement with the `x`/`y` it was dropped at.
   */
  place?: Placement;
  /**
   * How far in from the frame's edges a `place` sits, px: one number for both
   * axes, or `[x, y]`. Only the edges the placement touches are inset —
   * `place="bottom"` is inset from the bottom and centred across. Default 0.
   */
  inset?: number | [x: number, y: number];
};

type OffsetProps = {
  /**
   * Render-time translation on top of `x`/`y`, px — moves the drawn content
   * without changing the layout box (the property slide animations drive).
   * Subpixel values are kept. Defaults to 0.
   */
  offsetX?: number;
  offsetY?: number;
};

type SizeProps = {
  /** Box size, px. Defaults to the parent's size. */
  width?: number;
  height?: number;
  /**
   * Locks the box to its authored proportions: a resize of one bound drives
   * the other, so the editor's handles and layout rows keep the ratio
   * `width`:`height` has (or, with neither authored, the ratio the box
   * currently has — a media element locked at its natural size).
   */
  keepAspectRatio?: boolean;
};

type TransformProps = PositionProps & PlacementProps & OffsetProps & SizeProps & {
  /** Rotation in degrees. */
  rotation?: number;
  /**
   * 3D tilt in degrees, about the element's middle: `rotationX` tips the top
   * away (90 is edge-on), `rotationY` turns the right side away. The element
   * is drawn flat and turned as a picture, so a tilted group turns as one
   * card. Keyframeable; with motion blur the turn smears like any move.
   */
  rotationX?: number;
  rotationY?: number;
  /**
   * How far the camera a tilt is seen through stands from the element, px
   * (default 2000): nearer is a stronger 3D look, 0 none (the element only
   * foreshortens). On a `<repeater>` it is the camera of the copies.
   */
  perspective?: number;
  /** Uniform scale about the box origin, 1 = natural size. Overrides `scaleX`/`scaleY` while set. */
  scale?: number;
  /** Per-axis scale, 1 = natural size. */
  scaleX?: number;
  scaleY?: number;
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
  /** Uniform corner radius, px. */
  cornerRadius?: number;
  /**
   * Per-corner radius, px. A corner without one takes `cornerRadius`, so
   * `cornerRadius={20} cornerRadiusTopLeft={0}` rounds three corners.
   */
  cornerRadiusTopLeft?: number;
  cornerRadiusTopRight?: number;
  cornerRadiusBottomRight?: number;
  cornerRadiusBottomLeft?: number;
};

/** How an element composites, and whether it does at all. */
type CompositeProps = {
  /** Blend mode over what is below. Default "sourceOver". */
  blendMode?: BlendMode;
  /**
   * Excludes the element from rendering (and its audio from the mix) without
   * removing it: it keeps its place in the timeline and its children. Absent
   * means shown.
   */
  hidden?: boolean;
};

/**
 * Opting one element out of its scene's motion blur. `false` keeps it sharp —
 * a frame counter, a HUD, a logo that must never smear — while everything
 * around it blurs. Absent, the element blurs whenever its scene does.
 */
type MotionBlurOptOutProps = {
  motionBlur?: boolean;
};

type TimingProps = {
  /**
   * The `id` of an element this one follows: its span begins where that one's
   * ends, and `start` alongside it becomes the gap after it rather than a time
   * in the scene. Re-resolved whenever the target's span changes, so trimming
   * a clip moves everything after it instead of leaving a hole. An `after`
   * naming nothing leaves the element where it is.
   */
  after?: string;
  /** Parent-timeline time at which the node begins. Default 0. */
  start?: Time;
  /** Parent-timeline time at which the node ends. Alternative to `sourceOut`. */
  end?: Time;
  /** Source in point: where playback begins within the source, trimming the head. Default 0. */
  sourceIn?: Time;
  /** Source out point: where playback ends within the source. Defaults to the natural end. Alternative to `end`. */
  sourceOut?: Time;
  /**
   * Speed multiplier for the node's local time, 1 = normal: at 2, twice the
   * source plays in the same stretch of timeline. Default 1.
   */
  playbackRate?: number;
};

type SequenceItemProps = {
  /**
   * Transition into the next clip, rendered centered on the cut, set on the
   * outgoing clip. Only on direct children of `<Sequence>`; a partial value
   * merges into the clip's existing transition, `null` removes it.
   */
  transition?: TransitionSpec | null;
};

type FillProps = {
  /** Any CSS color, the node's intrinsic solid fill (drawn beneath any paint children); alpha is ignored — use `opacity`. */
  fill?: string;
};

type MediaProps = {
  /**
   * Path, URL, asset id, or a `generate.*` declaration. A path naming a
   * directory of numbered frames (`shot_001.png`, `shot_002.png`, ...) is an
   * image sequence, and plays on `<Video>` or `<Image>` as footage does — see
   * `frameRate` for how long it lasts. On `<Captions>` a transcript source
   * (.srt, .vtt, or transcript .json) mounted instead of transcribing the
   * scene; `generate.*` is not accepted there.
   */
  src: string | AssetRef;
  /**
   * Why this element's source never became an asset. Editor state carried by
   * the source like `selected`, and the answer to the `src` it was written
   * for: an element holding one is not resolved again, so a generation the
   * model refused is not run — or paid for — a second time by every reopen of
   * the project. The editor writes it when a generation or a transcription
   * fails; taking it off the element is what asks for the run again, and
   * nothing else does — not another take, not another prompt.
   */
  error?: string;
};

/**
 * Model calls the source is put through before the element shows it. The
 * `src` goes on naming what it was made from, so taking a modifier off gives
 * the original back; what they made is cached by source and modifiers, so it
 * is made once however many elements ask for it, and adding a second
 * modifier does not re-run the first. Applied in the order below.
 */
type UpscaleProps = {
  /**
   * Resolution multiplier: 2 asks for twice the pixels. Enlarges the source,
   * not the box — the element keeps the width and height it was given, and
   * renders sharper. Default 1, the source as it is.
   */
  upscale?: number;
};

type FitProps = {
  /** How the source maps into the box. Default "cover" on `<Video>`, "contain" on `<Image>`. */
  objectFit?: Fit;
};

type FrameRateProps = {
  /**
   * Frames per second for a `src` naming a directory of numbered frames — a
   * folder of pictures has a count, not a duration, so this is what says how
   * long the clip runs (600 frames at 24 is 25 seconds, at 60 is 10). Default
   * 30. Nothing for encoded video or a still to read: a file carries its own
   * rate, and neither has a frame count to divide.
   *
   * Not `playbackRate`, which retimes a source against the timeline whatever
   * its natural speed is; this is what that natural speed is. Unrelated to the
   * composition's own frame rate, which the export sets.
   */
  frameRate?: number;
};

type AudioTrackProps = {
  /** Decibels: 0 = unity gain, negative attenuates (-6 ≈ half as loud), -Infinity = silence. Use `muted` to silence. */
  volume?: number;
  /** Excludes the node's audio from the mix; independent of `volume`. */
  muted?: boolean;
  /**
   * `id` of another element carrying an audio track. Derives the timeline
   * placement (`start`) by cross-correlating the two audio signals so the
   * recordings coincide on the timeline. Mutually exclusive with `start`.
   */
  syncTo?: string;
};

type OpacityProps = {
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
};

type ColorProps = {
  /** Any CSS color: the glyph color on `<Text>`, the paint color on paints, strokes, shadows and color stops. */
  color: string;
};

/**
 * How glyphs are set: the style a `<text>` gives all its glyphs, and a
 * `<textRange>` gives the glyphs it spans. Every field is optional on both; on
 * a range an unset field inherits the text's, so a range says only what it
 * changes.
 */
type FontProps = {
  /** A family available on the machine (`posterract fonts`). */
  fontFamily?: string;
  /** Font size, px. */
  fontSize?: number;
  /** CSS weights 100–900, or "normal" / "bold". */
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  /**
   * Rules drawn along the text. Combine them with a space —
   * `"underline lineThrough"`. Default "none".
   */
  textDecoration?: "none" | "underline" | "lineThrough" | "underline lineThrough";
  /** Extra space between glyphs, px (negative tightens). Default 0. */
  letterSpacing?: number;
  /** Casing applied when drawing; the text itself is left as written. Default "original". */
  textCase?: TextCase;
};

/** What every visual node accepts on top of its own props. */
type CommonProps = IdentityProps & TransformProps & CompositeProps & MotionBlurOptOutProps & TimingProps & SequenceItemProps;

/**
 * Named numbers (or colours) that canvas code reads and the timeline drives.
 * Each knob is a timeline row: keyframe it with `<keyframeTrack
 * property="knob.<name>">`, and the code receives the value at every frame.
 * This is what keeps code-drawn motion visible and editable — the code draws,
 * the knobs move.
 */
export type Knobs = Record<string, number | string>;

/**
 * What a `<surface>`'s `draw` is told besides its knobs: the box it fills and
 * the canvas behind the context (for a library, like Three.js, that wants the
 * canvas itself).
 */
export type SurfaceDrawInfo = {
  /** The element's box, px. The canvas is this times `pixelRatio`, and the context is scaled to it. */
  width: number;
  height: number;
  pixelRatio: number;
  canvas: HostCanvas;
};

/**
 * Draws one frame of a `<surface>` from its knobs. Called by the renderer
 * whenever a knob or the box changes — never on its own clock, and never with
 * the time: anything that should move is a knob, keyframed on the timeline.
 * `context` is the canvas context the surface's `context` prop asks for
 * (a 2D context by default), cleared before each call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SurfaceDraw = (context: any, knobs: Readonly<Knobs>, info: SurfaceDrawInfo) => void;

/** What every paint accepts on top of its own props. */
type PaintProps = OpacityProps & CompositeProps;

/** Sub-entity children (`<KeyframeTrack>`) an element that is itself a style takes. */
type TrackChildren = {
  /** `<KeyframeTrack>` children. */
  children?: SolidJSX.Element;
};

/**
 * What every composition element accepts on top of its own props: the props
 * that address or wire the element rather than describe it. `id` is read by
 * the compile step and never seen by a host — it is how the source addresses
 * the element.
 */
export type SourceProps = {
  id?: string;
  /** Callback or variable ref, SolidJS-style; receives the element's `SceneNode` when it is created. */
  ref?: SceneNode | ((node: SceneNode) => void);
};

/**
 * A 2D affine transform as its six values, in the order CSS `matrix()` and
 * canvas `setTransform` take them: `[a, b, c, d, e, f]`, where `a`/`d` scale,
 * `b`/`c` skew, and `e`/`f` translate. See `StageProps["camera"]`.
 */
export type CameraMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * The infinite canvas every project renders into; only allowed as the root
 * element, and holding `<scene>` children.
 */
export type StageProps = {
  /** Canvas color, any CSS color. */
  background?: string;
  /**
   * The editor's viewport: `[1, 0, 0, 1, 0, 0]` is the origin at 100%.
   *
   * @deprecated Editor view state, not part of the composition: nothing
   * rendered or exported depends on it. The editor fits the composition into
   * its window on open and remembers a manual pan or zoom in
   * `.posterract/view.json` beside the project, so a source has no reason to
   * carry one; one that still does has it lifted out the next time it is
   * opened. Still accepted so such a source keeps compiling; do not author it.
   */
  camera?: CameraMatrix;
  children?: SolidJSX.Element;
};

/**
 * A scene: the clipped, playable frame a composition is made in, and the only
 * element allowed directly under `<stage>`. It clips its children to
 * `width`×`height` and owns the timeline they are placed on, so it takes no
 * timing of its own — nothing outside a scene has a clock to place it against.
 *
 * `x`/`y` are where the frame sits on the infinite canvas. Whether the editor
 * has it selected, and whether the timeline is pointed at it, are where the
 * author is looking rather than part of the composition; the editor remembers
 * them in `.posterract/view.json` beside the project, not in the source.
 */
export type SceneProps = IdentityProps & PositionProps & Required<Pick<SizeProps, "width" | "height">> & Pick<SizeProps, "keepAspectRatio"> & FillProps & {
  /**
   * Whether this element is the one the playhead, timeline, and capture
   * operate on. Two rules the runtime holds: at most one element is active,
   * and only a root (a direct child of `<stage>`) can be.
   *
   * @deprecated Editor view state, as `selected` is; see there. The editor
   * opens on the scene it remembers, or on the first one; export and capture
   * name their scene by id and never read this.
   */
  active?: boolean;
  /**
   * The skill this scene is made with: the `name` of a skill folder (a
   * SKILL.md with its assets), chosen from the editor's Skill Deck or set by
   * an agent. It is part of the document — the scene means "a video of this
   * kind" — and the agent reads it to know which SKILL.md to follow. A name
   * whose folder is not installed on this machine is kept, not dropped.
   */
  skill?: string;
  /**
   * Decibels on the scene's own bus, which everything in it mixes into: the
   * master fader. 0 = unity, negative attenuates (-6 = half as loud),
   * -Infinity = silence. A clip's own `volume` composes with this one.
   */
  volume?: number;
  /**
   * The stretch of the scene that plays and exports, as `[in, out]`: playback
   * loops within it, and an export is of it and nothing else — so this is
   * where a render is trimmed. `null` for the whole scene, which is what a
   * scene without one is.
   *
   * Editor state carried by the source the way `active` is (the timeline's
   * brackets have nowhere else to be written back to), but unlike `active` it
   * is read wherever the file is: what it says is what comes out of a render.
   */
  workarea?: [inPoint: Time, outPoint: Time] | null;
  /**
   * Motion blur, the smear a real camera gives anything that moves while its
   * shutter is open. `true` is a 180° shutter with 8 samples; a number is the
   * shutter angle in degrees (0–360, the fraction of a frame the shutter is
   * open); an object sets both. Each exported frame is that many in-between
   * moments blended, so fast moves read as one continuous motion instead of
   * a string of sharp jumps — and the export takes about that many times as
   * long. Shown in the editor while paused and scrubbing; an element opts out
   * with `motionBlur={false}`. Absent or `false`, frames are sharp.
   */
  motionBlur?: boolean | number | { shutter?: number; samples?: number };
  /**
   * The scene's tempo, in beats per minute. Puts bars and beats on the
   * timeline, lets clips and keyframes snap to them, and gives every time prop
   * musical units: "4b" is four beats, "2bar" two bars (see `Time`). Set it
   * from the music — `posterract media beats` measures it.
   */
  bpm?: number;
  /** Beats in a bar. Default 4. */
  meter?: number;
  children?: SolidJSX.Element;
};

/**
 * `<group>` — a container: its box is the union of its children, and its
 * transform, opacity, timing and effects apply to all of them. `stagger`
 * offsets each child's animations from the one before.
 */
export type GroupProps = CommonProps & FillProps & {
  /**
   * How far apart the group's children's motion runs, as a `Time`.
   *
   * The nth child reads the clock `n × stagger` behind its siblings, so one
   * animation authored on the children arrives as a cascade. Nothing is
   * written per child: the offset is applied when motion is sampled, so the
   * source stays one element and each child keeps one timeline row. Nested
   * staggers add — one over rows and another over the cells in a row
   * cascades in both directions.
   */
  stagger?: Time;
  /** Element children, plus `<Effect>` (filtering the group as a whole), `<Animation>` and `<KeyframeTrack>` children. */
  children?: SolidJSX.Element;
};

/**
 * `<adjustmentLayer>` — a layer that draws nothing of its own and transforms
 * the clip below it: while the layer's own clip lasts, its transform composes
 * onto that of the sibling directly beneath it in the stack. A punch-in, a
 * drift or a keyframed zoom is therefore authored once, in a row of its own,
 * and trimmed and slid along the timeline without the clip it acts on being
 * touched. In a `<sequence>` the layer acts on what sits below the sequence,
 * not below the layer inside it.
 *
 * `width`/`height` are never drawn: they are the box the transform pivots
 * around, so `rotation` and `scale` turn about the middle of a frame that
 * size. Default 1920x1080 — set them to the scene's own size on a frame
 * shaped otherwise.
 */
export type AdjustmentLayerProps =
  & IdentityProps
  & Omit<TransformProps, "opacity" | "cornerRadius" | "cornerRadiusTopLeft" | "cornerRadiusTopRight" | "cornerRadiusBottomRight" | "cornerRadiusBottomLeft">
  & Pick<CompositeProps, "hidden">
  & TimingProps
  & SequenceItemProps
  & {
    /** `<Animation>` and `<KeyframeTrack>` children — what the layer's transform is animated with. */
    children?: SolidJSX.Element;
  };

/**
 * `<rect>` — a box, the basic shape: filled with `fill` (or paint children),
 * rounded with `cornerRadius`, and the base of a mask (`mask`).
 */
export type RectProps = CommonProps & FillProps & {
  /**
   * Makes the rect a mask of its parent: it clips the parent (its fills,
   * strokes and children show only inside the rect's box) instead of drawing.
   * The rect keeps its transform, `cornerRadius` and timing — a keyframed
   * mask sliding across a text is a wipe, one that ends early lets go — and
   * several masks under one parent intersect. A mask is never rendered or
   * hit, so its `fill`, `opacity`, `blendMode` and paint children have no
   * effect. Without `width`/`height` a mask is 500×500, and without `end` it
   * clips for the parent's whole window.
   */
  mask?: boolean;
  /**
   * Paint children (`<SolidPaint>`, `<LinearGradientPaint>`,
   * `<RadialGradientPaint>`), plus `<Stroke>`, `<Shadow>`, `<Effect>`,
   * `<Animation>` and `<KeyframeTrack>` children.
   */
  children?: SolidJSX.Element;
};

/**
 * Trim Paths — which fraction of a vector figure is actually drawn.
 *
 * `trimEnd` animated from 0 to 1 is the classic draw-on: the line appears as
 * if it were being drawn. `trimOffset` rotates the visible window around the
 * figure, so a short window can chase around a closed shape without stopping
 * at its seam. All three are keyframeable (`trim.start`, `trim.end`,
 * `trim.offset` — authored as `trimStart`, `trimEnd`, `trimOffset`).
 */
type TrimProps = {
  /** Where the drawn part begins, 0–1 of the whole figure. Default 0. */
  trimStart?: number;
  /** Where it ends, 0–1. Default 1 — the whole figure. */
  trimEnd?: number;
  /** Rotates the window around the figure, in turns. Default 0. */
  trimOffset?: number;
};

/**
 * `<path>` — a free vector figure in SVG path syntax.
 *
 * The `d` coordinates are the figure's own; without `width`/`height` the
 * element takes the box its geometry occupies, the way an SVG bounding box
 * does. Fills, strokes, shadows, effects and masks all work as they do on a
 * `<rect>`.
 */
export type PathProps = CommonProps & FillProps & TrimProps & {
  /**
   * SVG path data: `M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, `Z`.
   * Keyframeable as `d` — each keyframe's `value` a shape — so a figure can
   * turn into any other and then another, circle → square → triangle.
   */
  d: string;
  /**
   * A second figure to blend toward, as path data. Shapes whose command
   * sequences match blend command for command; any other pair blends through
   * matched outlines, so any shape can turn into any other.
   */
  morphTo?: string;
  /** How far toward `morphTo`, 0–1. Keyframeable as `morph`. Default 0. */
  morph?: number;
  /** Makes the path a mask of its parent — see `RectProps["mask"]`. */
  mask?: boolean;
  /** Paint, stroke, shadow, effect, animation and keyframe children. */
  children?: SolidJSX.Element;
};

/**
 * `<ellipse>` — an ellipse inscribed in the element's box.
 *
 * `width` and `height` are the box, so a circle is a square one. Built from
 * arcs rather than drawn as a primitive, so `trim` works on it: a ring that
 * draws itself is `trimEnd` from 0 to 1.
 */
export type EllipseProps = CommonProps & FillProps & TrimProps & {
  /** Makes the ellipse a mask of its parent — see `RectProps["mask"]`. */
  mask?: boolean;
  children?: SolidJSX.Element;
};

/**
 * `<polygon>` — a closed figure through a list of points.
 */
export type PolygonProps = CommonProps & FillProps & TrimProps & {
  /** `"x,y x,y …"` in the element's own coordinates. */
  points: string;
  /** Makes the polygon a mask of its parent — see `RectProps["mask"]`. */
  mask?: boolean;
  children?: SolidJSX.Element;
};

/** Shapes available to a first-class Posterract diagram node. */
export type DiagramNodeShape = "rounded" | "pill" | "circle" | "diamond" | "hexagon";

/** Connector routing available to diagram arrows. */
export type DiagramRoute = "straight" | "elbow" | "curve";

/** A data-space point consumed by `<diagramPlot>`. */
export type DiagramPoint = readonly [x: number, y: number];

type DiagramVisualProps = CommonProps & {
  /** Primary diagram stroke. Defaults to Posterract green. */
  strokeColor?: string;
  /** Primary diagram stroke width, px. */
  strokeWidth?: number;
  /** Text color used by built-in diagram labels. */
  textColor?: string;
  /** Built-in label type size, px. */
  fontSize?: number;
  /** Built-in label font family. */
  fontFamily?: string;
  /** Built-in label font weight. */
  fontWeight?: number | "normal" | "bold";
  /**
   * 0–1 reveal amount used for agent-authored draw-on animation, clamped to
   * that range. Animatable: a `<keyframeTrack property="progress">` child
   * drives it over time and takes precedence over this prop while it runs.
   */
  progress?: number;
  /** Effects, animations, keyframes, paints, strokes, and other supported children. */
  children?: SolidJSX.Element;
};

/**
 * A selectable diagram node with its label rendered as part of the same
 * source-backed editor entity. Use normal x/y/width/height props to place it.
 */
export type DiagramNodeProps = DiagramVisualProps & FillProps & {
  label: string;
  subtitle?: string;
  shape?: DiagramNodeShape;
  padding?: number;
};

/** A selectable connector or arrow. Its path runs from (0,0) to (width,height). */
export type DiagramArrowProps = DiagramVisualProps & {
  route?: DiagramRoute;
  arrowStart?: boolean;
  /** Defaults to true. */
  arrowEnd?: boolean;
  headSize?: number;
  label?: string;
};

/** A selectable mathematical statement or formula. */
export type DiagramEquationProps = DiagramVisualProps & {
  expression: string;
  /** Optional caption drawn below the expression. */
  label?: string;
  align?: "left" | "center" | "right";
};

/** A selectable x/y coordinate system with deterministic ticks and labels. */
export type DiagramAxisProps = DiagramVisualProps & {
  domain?: readonly [min: number, max: number];
  range?: readonly [min: number, max: number];
  tickCount?: number;
  grid?: boolean;
  xLabel?: string;
  yLabel?: string;
  padding?: number;
};

/** A selectable plot of explicit data points, mapped through domain and range. */
export type DiagramPlotProps = DiagramVisualProps & {
  points: readonly DiagramPoint[];
  domain?: readonly [min: number, max: number];
  range?: readonly [min: number, max: number];
  /** Draw a dot at every point in addition to the path. */
  markers?: boolean;
  /** Smooth the path with a curve rather than straight segments. */
  smooth?: boolean;
  padding?: number;
  label?: string;
};

/** A labeled panel with a pointer aimed at a local target coordinate. */
export type DiagramCalloutProps = DiagramVisualProps & FillProps & {
  label: string;
  subtitle?: string;
  targetX?: number;
  targetY?: number;
  padding?: number;
};

/**
 * `<stroke>` — an outline of the parent's box (or glyphs), a sub-entity like a
 * paint: `color`/`opacity` are its paint, `width`/`join`/`cap`/`miterLimit`
 * its line style. Several stack in document order, later ones on top.
 */
export type StrokeProps = ColorProps & PaintProps & TrackChildren & {
  /** Line width, px. Default 1. */
  width?: number;
  /** How the stroke turns corners. Default "miter". */
  join?: StrokeJoin;
  /** How the stroke ends open paths (text glyphs). Default "butt". */
  cap?: StrokeCap;
  /** Miter length limit, as a ratio of the width. Default 10. */
  miterLimit?: number;
};

/**
 * `<shadow>` — a drop shadow beneath the parent's box (or glyphs): a blurred,
 * offset copy of its silhouette in `color`. Several stack in document order.
 */
export type ShadowProps = ColorProps & OpacityProps & Pick<CompositeProps, "hidden"> & TrackChildren & {
  /** Blur radius, px. Default 0. */
  blur?: number;
  /** Where the shadow sits relative to the silhouette, px. Default 0. */
  offsetX?: number;
  offsetY?: number;
};

/**
 * `<effect>` — a filter over the parent's rendered pixels (its fills, strokes
 * and children together), a sub-entity like a paint. Several stack in
 * document order.
 */
export type EffectProps = Pick<CompositeProps, "hidden"> & TrackChildren & {
  /** Which filter to apply. */
  type: EffectType;
  /**
   * The amount: px for "blur", "chromaticAberration" and "directionalBlur",
   * degrees for "hueRotate", 0–2 for "glow", 0–1 otherwise. Keyframeable as
   * `value`.
   */
  value: number;
  /**
   * The second number the finishing effects take: the grain's size in px, how
   * far a vignette reaches (0–1), a glow's radius in px. Keyframeable as `size`.
   */
  size?: number;
  /** A "directionalBlur"'s direction, degrees (0 = across). Keyframeable as `angle`. */
  angle?: number;
};

/**
 * `<animation>` — one preset in/out animation of the node holding it, played
 * over the clip's head or tail. Several stack in document order, later ones
 * writing over earlier ones on the properties they share; a `<keyframeTrack>`
 * on the same property overrides the preset while it has keyframes.
 */
export type AnimationProps = {
  /** Which preset plays. */
  type: AnimationType;
  /** "in" plays from the clip's head, "out" into its tail. Default "in". */
  phase?: "in" | "out";
  /** Length of the animation. Any `Time` format. Default 1 second. */
  duration?: Time;
  /**
   * Gap between the clip edge and the animation: after the head for "in",
   * before the tail for "out". Any `Time` format. Default 0.
   */
  delay?: Time;
  /**
   * How far it travels, px: the length of a slide (default 100), the drift of
   * a "twist" (default 30). Other presets do not travel.
   */
  distance?: number;
  /**
   * How strong the preset is, in the preset's own measure: "fade" — how much
   * of the opacity it covers, 0–1 (default 1); "grow" / "shrink" — how much
   * smaller / larger it starts, as a scale (default 0.5, so from 50% / 150%);
   * "blur" — the blur it starts from, px (default 24); the slides — how much
   * they fade while they travel, 0–1 (default 1, and 0 slides at full
   * opacity); "spin" / "twist" — the rotation it starts from, degrees
   * (default 45 / 10). "gain" and the text reveals have none.
   */
  amount?: number;
  /**
   * The curve it plays with, in place of the preset's own. A spring
   * ("bouncy", `spring(0.4,500)`) overshoots where the preset moves or scales.
   */
  easing?: Easing;
};

/**
 * `<keyframeTrack>` — the keyframes of one prop of the element holding it,
 * as elements, so an editor moving a keyframe has an element to write it to.
 * One track per prop; the prop's static value is what holds when the track
 * is empty. Outside the keyframed range the value holds at the first/last
 * keyframe, unless the track has a `loop`.
 */
export type KeyframeTrackProps = {
  /** Which prop of the holding element the track animates. */
  property: AnimatableProperty;
  /**
   * What the track does after its last keyframe, for as long as the element is
   * on screen: `loop` (or "repeat") plays first → last again and again,
   * "pingpong" plays it there and back. Without it the last value holds.
   * Anything that keeps moving — a bob, a pulse, a wiggle — is its few
   * keyframes and a `loop`, not a keyframe per change of direction; for a
   * repeat to be seamless, end on the value it starts from.
   */
  loop?: boolean | "repeat" | "pingpong";
  /** `<Keyframe>` children, in any order; they sort by `time`. */
  children?: SolidJSX.Element;
};

/**
 * `<lottie>` — a Lottie/Bodymovin animation as a composition element.
 *
 * Lottie brings bezier paths, trim-path draw-on, morphing, mattes and precomps
 * without Posterract having to grow a vector engine first. It is rendered by
 * seeking the animation to composition time on every frame — never by playing
 * it — so preview and export are the same frames.
 */
export type LottieProps = IdentityProps & PositionProps & TimingProps & OffsetProps & {
  /** Path to a Lottie JSON in the project, or an imported asset. */
  src: string;
  /** Drawing size. Defaults to the animation's own. */
  width?: number;
  height?: number;
  /** Multiplies the animation's own clock; 1 is real time. Default 1. */
  speed?: number;
  /** Repeat for the element's whole span rather than holding the last frame. */
  loop?: boolean;
  /** `<lottieSlot>` children. */
  children?: SolidJSX.Element;
};

/**
 * `<lottieSlot>` — one editable value inside a Lottie animation.
 *
 * Slots are how a Lottie file exposes its colours and text for reuse. As
 * elements they are inspectable and keyframable like any other property.
 */
export type LottieSlotProps = {
  /** The slot's name in the Lottie file. */
  name: string;
  /** Its value: a CSS color, a string for a text slot, or a number. */
  value: string | number;
};

/**
 * `<duck>` — hold one clip's level down while another one plays.
 *
 * The music under a voiceover, stated once instead of drawn as a volume
 * track: `target` is what gets quieter, `by` is what makes it quieter. The
 * envelope leads the ducking clip by `attack` and recovers over `release`,
 * the way a person rides a fader, and it is derived from that clip's span —
 * so trimming the voiceover moves the duck with it, and scrubbing into the
 * middle of one shows the level an export writes there.
 *
 * Valid under a `<scene>`. Several ducks on the same target add up.
 */
export type DuckProps = {
  /** `id` of the element that gets quieter. */
  target: string;
  /** `id` of the element whose span drives the duck. */
  by: string;
  /** How far down, in dB. Negative. Default -12. */
  amount?: number;
  /** How long the level takes to give way, leading the clip. Default 0.1s. */
  attack?: Time;
  /** How long it takes to come back. Default 0.4s. */
  release?: Time;
};

/**
 * `<cue>` — one caption line, valid only inside `<captions>`.
 *
 * Cues make captions part of the document rather than a file the composition
 * points at: their text and timing can be edited, versioned, and read by an
 * agent, and they survive without the transcript asset that produced them.
 * A `<captions>` holding cues ignores its `src`.
 */
export type CueProps = {
  /** When the line appears, in scene-local time. Any `Time` format. */
  start: Time;
  /** When it leaves. Any `Time` format. */
  end: Time;
  /** The line itself. */
  children?: SolidJSX.Element;
};

/**
 * `<marker>` — a named point on a scene's timeline.
 *
 * Markers are notes on the edit, not content: they render nothing and change
 * nothing about the output. They exist so a person or an agent can label a
 * beat, a cut, or a place to come back to, and have that label survive in the
 * source rather than in someone's memory.
 */
export type MarkerProps = {
  /** Where the marker sits, in scene-local time. Any `Time` format. */
  time: Time;
  /** What the marker is for. Shown on the ruler. */
  name?: string;
  /** Any CSS color; defaults to the editor's accent. */
  color?: string;
};

/** `<keyframe>` — one keyframe of the `<keyframeTrack>` holding it. */
export type KeyframeProps = {
  /** Node-local time: 0 is where the clip begins (its `start`). Any `Time` format. */
  time: Time;
  /** The value at `time`: a number, any CSS color on a `color` track, or path data on a `d`/`path` track. */
  value: number | string;
  /** Shapes the segment to the next keyframe; ignored on the last. Default "linear". */
  easing?: Easing;
};

/** `<solidPaint>` — a flat `color` fill of the parent's shape. */
export type SolidPaintProps = ColorProps & PaintProps & TrackChildren;

/**
 * `<linearGradientPaint>` / `<radialGradientPaint>` — a gradient fill of the
 * parent's shape, through its `<colorStop>` children.
 */
export type GradientPaintProps = PaintProps & {
  /** Gradient rotation in degrees. Defaults to 0 (left to right). */
  rotation?: number;
  /** `<ColorStop>` children — the gradient's color stops. */
  children?: SolidJSX.Element;
};

/** `<colorStop>` — one color of a gradient, at `offset` 0–1 along it. */
export type ColorStopProps = ColorProps & OpacityProps & TrackChildren & {
  /** Position along the gradient, 0–1. */
  offset: number;
};

/**
 * `<imagePaint>` / `<videoPaint>` — an asset painted into the parent
 * geometry's box, a paint child like a solid or a gradient (several stack in
 * document order). The node tags `<image>` / `<video>` are the same media as
 * an element of its own; these fill something else with it, so a rect or a
 * text can be filled with a picture. Which tag it is only says what the source
 * is expected to be: the paint follows what the src turns out to name, so a
 * frames directory plays under either.
 */
export type MediaPaintProps = PaintProps & MediaProps & FitProps & FrameRateProps & TrackChildren;

/**
 * `<video>` — a video clip: `src`, placed in time with `start`/`end`, trimmed
 * with `sourceIn`/`sourceOut`, and fitted into its box with `objectFit`
 * (`cover` unless said otherwise).
 */
export type VideoProps = CommonProps & MediaProps & FitProps & FrameRateProps & AudioTrackProps & UpscaleProps & {
  /**
   * Scores the footage: a generated soundtrack for a clip that has none. See
   * `UpscaleProps` for what a modifier is; applied last, after `upscale`, so
   * a re-encode cannot drop the track. Independent of `volume` and `muted`,
   * which mix whatever track the clip ends up with.
   */
  addAudio?: boolean;
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

/**
 * `<image>` — a still image (or a directory of frames): `src`, fitted into
 * its box with `objectFit` (`contain` unless said otherwise).
 */
export type ImageProps = CommonProps & MediaProps & FitProps & FrameRateProps & UpscaleProps & {
  /**
   * Cuts the subject out, leaving the rest of the picture transparent. See
   * `UpscaleProps` for what a modifier is; applied before `upscale`.
   */
  removeBackground?: boolean;
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

/** `<htmlPaint>` — real DOM children, laid out at the parent's box size and drawn into it. */
export type HtmlPaintProps = PaintProps & {
  /**
   * HTML children — real DOM elements laid out by the browser at the parent
   * geometry's box size and drawn into it (html-in-canvas). Fully reactive:
   * signals in attributes and text update the drawn content.
   */
  children?: SolidJSX.Element;
};

/**
 * `<Html>` — a rectangle whose intrinsic paint draws the given DOM children.
 * `knobs` reach the DOM as CSS custom properties on its root (`--tilt`), set
 * every frame, so the content can move with `calc(var(--tilt) * 1deg)` while
 * the timeline drives the knob.
 */
export type HtmlProps = CommonProps & Pick<HtmlPaintProps, "children"> & {
  knobs?: Knobs;
};

// HTMLCanvasElement without requiring the DOM lib (this package also
// type-checks in node contexts): the real type when present, a structural
// stub otherwise.
type HostCanvas = typeof globalThis extends { HTMLCanvasElement: new () => infer T } ? T
  : { width: number; height: number; getContext(contextId: string, options?: unknown): unknown };

/** `<ShaderPaint>` — transforms the media paint directly below it. Takes no children. */
export type ShaderPaintProps = PaintProps & {
  /**
   * Fragment-stage WGSL, applied to the video/image paint directly below it
   * in the paint stack, or run procedurally (over a transparent source) when
   * there is none. Entry point
   * `@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f`;
   * sample the media with `sampleSource(uv)`.
   */
  wgsl: string;
  /**
   * Values for the shader's `@group(1)` uniform declarations, matched by
   * name: numbers bind to `f32`, arrays of 2-4 to `vec2f`-`vec4f`, CSS
   * color strings to `vec3f`/`vec4f`. Each number is keyframeable as
   * `uniform.<name>` and shows as its own timeline row.
   */
  uniforms?: Record<string, number | number[] | string>;
};

/**
 * One element of the mounted document, and its place in it: what an element's
 * `ref` receives, and the one object the document and the renderer both hold
 * for the entity, so `===` between two of them means what it says. Both ref
 * forms work, as in SolidJS: `ref={(node) => ...}` and
 * `let surfaceRef: SceneNode | undefined; <surface ref={surfaceRef} />`.
 *
 * `E` is what `element` holds. It defaults to the backing canvas — the main
 * consumer, a `<surface>` / `<surfacePaint>` ref — and the runtime document
 * instantiates it with the DOM node type it manages.
 */
export interface SceneNode<E = HostCanvas> {
  /** The Koota entity the element rendered into; `entity.get`/`set` reach the runtime traits. */
  readonly entity: Entity;
  /** Native composition elements participate in the Koota scene graph. */
  readonly native: boolean;
  /** The camelCase tag the element was authored as. */
  tag: string;
  props: Record<string, unknown>;
  parent: SceneNode<E> | null;
  children: SceneNode<E>[];
  /**
   * The real DOM node backing the element, null where there is none — typed
   * for the main consumer, a `<surface>` / `<surfacePaint>`'s backing canvas.
   * Draw to it with any context type (2d, webgl, webgpu); the engine samples
   * the bitmap every frame and stretches it into the holder's box. The canvas
   * is allocated with the element and sized to the holder's `width`/`height`
   * (a same-size set is a no-op, so `renderer.setSize` from your own code is
   * not clobbered). Purely-native elements (rects, text, scenes) carry no DOM
   * node, and an `<html>` subtree's is really its root element.
   */
  readonly element: E | null;
}

/** `<surfacePaint>` — a canvas the element's `ref` draws into (`element` on the received node). Takes no children. */
export type SurfacePaintProps = PaintProps;

/**
 * `<Surface>` — a rectangle drawn by code.
 *
 * The way to write one is `draw` and `knobs`: `draw` paints a frame from the
 * knob values, and every knob is a timeline row that can be keyframed. The
 * renderer calls `draw` whenever a knob moves, so the code never runs on a
 * clock of its own and everything that moves is visible — and editable — on
 * the timeline. A surface driven through its `ref` and `useTicker` instead
 * still works, but its motion is invisible to the timeline and `lint` reports
 * it as hidden motion.
 */
export type SurfaceProps = CommonProps & {
  /** The named numbers `draw` reads — see `Knobs`. */
  knobs?: Knobs;
  /** Paints one frame from the knobs — see `SurfaceDraw`. */
  draw?: SurfaceDraw;
  /** The context `draw` receives. Default "2d". */
  context?: "2d" | "webgl" | "webgl2";
};

/**
 * `<textAnimator>` — moves a `<text>` one letter, word or line at a time.
 *
 * Its `<keyframeTrack>` children animate `offsetX`, `offsetY`, `rotation`,
 * `scale`, `opacity` and `blur`, and each unit plays them from its own start,
 * `stagger` after the one before — so one track written once arrives as
 * letters rising in a wave. Keyframe times are the unit's own: 0 is when that
 * letter begins to move.
 */
export type TextAnimatorProps = {
  /** What moves as one. Default "letter". */
  by?: "letter" | "word" | "line";
  /** Time between one unit starting and the next. Any `Time` format. Default 0.04 s. */
  stagger?: Time;
  /** Which unit goes first. Default "forward". */
  order?: "forward" | "reverse" | "center" | "edges" | "random";
  /** `<keyframeTrack>` children over the unit props listed above. */
  children?: SolidJSX.Element;
};

/** How a `<repeater>` lays its copies out — see `RepeaterProps`. */
export type RepeaterLayout =
  | "line"
  | "grid"
  | "plane"
  | "circle"
  | "sunflower"
  | "spiral"
  | "sphere"
  | "torus"
  | "cube"
  | "random";

/**
 * `<repeater>` — one element drawn many times, laid out by rule.
 *
 * Its single element child is the template; the repeater draws `count` copies
 * of it in a `layout` — a ring, a grid, a sunflower, a sphere, a donut, the
 * edges of a cube — and can blend toward a second layout (`layoutTo`, `morph`),
 * send a ripple through the copies, and view them in 3D through a camera
 * (`tiltX`, `tiltY`, `roll`, `zoom`, `perspective`, `cameraZ`). Every number
 * is keyframeable by name, so one timeline row holds what would otherwise be
 * hundreds, and a `stagger` plays the template's own animation one copy after
 * another.
 */
export type RepeaterProps = IdentityProps & PositionProps & PlacementProps & OffsetProps
  & Pick<TransformProps, "rotation" | "scale" | "scaleX" | "scaleY" | "opacity">
  & CompositeProps & MotionBlurOptOutProps & TimingProps & SequenceItemProps & {
    /** How many copies. Default 12. */
    count?: number;
    /** Default "circle". 2D layouts lie in the frame; "plane" is a grid lying flat (edge-on until tilted); "sphere", "torus" and "cube" are 3D. */
    layout?: RepeaterLayout;
    /** A second layout the copies blend toward, copy for copy. */
    layoutTo?: RepeaterLayout;
    /** How far toward `layoutTo`, 0–1. */
    morph?: number;
    /** Columns of a "grid" or "plane"; 0 picks a square. Default 0. */
    columns?: number;
    /** Distance between neighbours, px — the pitch of a line, grid, plane, sunflower or spiral. Default 40. */
    spacing?: number;
    /** Size of a circle, sphere, torus ring, cube (half its edge), spiral or random cloud, px. Default 200. */
    radius?: number;
    /** A torus's tube radius, px. Default 60. */
    tube?: number;
    /** Seed of the "random" layout and the "random" stagger order. Default 1. */
    seed?: number;
    /** Height of a wave travelling through the copies: px of depth, or a size factor with `rippleMode="scale"`. Default 0. */
    ripple?: number;
    /** Wave crests per 1000 px. Default 2. */
    rippleFrequency?: number;
    /** Where the wave is, in radians — keyframe it to make the wave travel. */
    ripplePhase?: number;
    /** What the wave moves: depth ("z", the default) or the copies' size ("scale"). */
    rippleMode?: "z" | "scale";
    /** Where the wave starts, px from the layout's centre. */
    rippleCenterX?: number;
    rippleCenterY?: number;
    /**
     * Camera pitch, degrees. Positive tips the top away from the viewer, as CSS
     * `rotateX` does: a "grid" at 60 leans back into a floor. A "plane" or a
     * "torus" lies flat already and is seen from above with a negative tilt.
     */
    tiltX?: number;
    /** Camera yaw, degrees — keyframe it to spin a sphere. */
    tiltY?: number;
    /** Camera roll, degrees. */
    roll?: number;
    /** Scales the positions and the copies together. Default 1. */
    zoom?: number;
    /** Focal length, px: 0 is flat (orthographic); around 800 looks natural. Default 0. */
    perspective?: number;
    /** Moves the camera toward the copies, px; past them it flies through. */
    cameraZ?: number;
    /** How much farther copies fade, 0–1. Default 0. */
    depthFade?: number;
    /** Time between one copy's animation and the next. Any `Time` format. */
    stagger?: Time;
    /** Which copy goes first when staggered. Default "index". */
    staggerOrder?: "index" | "reverse" | "center" | "edges" | "random" | "radial";
    /** A second colour the copies' fill blends toward, by `colorBy`. */
    colorTo?: string;
    /** What picks each copy's blend toward `colorTo`: its place in the order, the ripple, or its depth. Default "wave". */
    colorBy?: "index" | "wave" | "depth";
    /** One element child — the template — plus `<keyframeTrack>` and `<animation>` children. */
    children?: SolidJSX.Element;
  };

/**
 * `<audio>` — a clip with a sound and no picture. It draws nothing inside a
 * scene, but on the canvas it is still something to point at: the editor
 * shows its waveform in a box, and `x`/`y`/`width`/`height` are where that
 * box is. Left off inside a scene, where they mean nothing.
 */
export type AudioProps = IdentityProps & PositionProps & SizeProps & TimingProps & MediaProps & AudioTrackProps & {
  /** `<KeyframeTrack>` (a `volume` track) and `<Animation>` children. */
  children?: SolidJSX.Element;
};

/**
 * `<text>` — text: what it says is its children, and its color is `color`
 * (not `fill`). The box sizes itself to the text unless `width` is given,
 * which is then the width lines wrap at.
 */
export type TextProps = CommonProps & Partial<ColorProps> & FontProps & {
  /** Horizontal alignment of glyphs within the box. Default "left". */
  textAlign?: "left" | "center" | "right";
  /**
   * Vertical alignment within the box: the block anchored to the top or
   * bottom of the box or centered, or ("alphabetic") the first line's baseline
   * at the top of the box. Default "top".
   */
  textBaseline?: "top" | "middle" | "bottom" | "alphabetic";
  /** Line height as a multiple of each line's natural height. Default 1. */
  leading?: number;
  /**
   * Lays the text along a path instead of in lines, as path data in the
   * element's own coordinates: every glyph sits on the curve, turned to follow
   * it. A closed path (a circle) lets the text run round and round. Keyframeable
   * as `path` — shape keyframes — so a straight line of text can bend into a
   * ring.
   */
  path?: string;
  /** How far along the path the text sits, as a fraction of its length; wraps on a closed path. Keyframe it to scroll. Default 0. */
  pathOffset?: number;
  /** Which part of the text sits at `pathOffset`. Default "start". */
  pathAlign?: "start" | "center" | "end";
  /** Moves the text off the path, px — outward is positive on a clockwise circle. Default 0. */
  pathShift?: number;
  /**
   * The text content, required; alongside it, `<TextRange>`, `<TextAnimator>`,
   * paint, `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and
   * `<KeyframeTrack>` children.
   */
  children: SolidJSX.Element;
};

/**
 * `<textRange>` — a style override for a run of the parent `<text>`'s glyphs,
 * a sub-entity like a paint: `start`/`end` address the run by character index
 * into the text as written (before `textCase`), the rest is what changes
 * inside it. Its own `color`, paints, strokes and shadows replace the text's
 * for those glyphs; an unset font field inherits. Several stack in document
 * order, later ones winning where they overlap; layout stays the text's
 * (`textAlign`, `textBaseline`, `leading` are not per range).
 */
export type TextRangeProps = Partial<ColorProps> & FontProps & {
  /** First character of the run, 0-based. */
  start: number;
  /** One past the last character of the run. Defaults to the end of the text. */
  end?: number;
  /** Paint, `<Stroke>`, `<Shadow>` and `<KeyframeTrack>` (a `color` track) children. */
  children?: SolidJSX.Element;
};

/**
 * `<sequence>` — plays its children back to back in document order; a
 * child's `transition` blends it into the next.
 */
export type SequenceProps = Pick<IdentityProps, "name"> & {
  children?: SolidJSX.Element;
};

/**
 * `<captions>` — timed captions drawn in a `preset` style, from a transcript
 * `src` or from `<cue>` children. The words stay text, so they can be edited.
 */
export type CaptionsProps = IdentityProps & TimingProps & OffsetProps & Partial<MediaProps> & {
  /** Caption style preset. Default "classic". */
  preset?: CaptionPreset;
  /** Fills the caption preset's color slots in order; any CSS color, alpha is ignored. */
  colors?: string[];
  /**
   * Vertical placement of the caption block: anchored to the top or bottom
   * safe margin, or centered. The preset keeps owning the horizontal
   * placement. Defaults to the preset's own alignment.
   */
  verticalAlign?: "top" | "center" | "bottom";
  /**
   * Transcription seed. Part of the transcript cache key (scene id + seed),
   * so a new value bypasses the cached transcript and transcribes the scene
   * again; reusing a value replays that take from cache. Default 0.
   */
  seed?: number;
  /** `<Animation>` children. */
  children?: SolidJSX.Element;
};
