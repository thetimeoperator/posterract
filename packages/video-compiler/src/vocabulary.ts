/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The composition vocabulary, as something code can ask questions of.
 *
 * The data is generated from the composition package's types (see its
 * scripts/vocabulary.mjs) and never edited by hand; this module is the reading
 * side: what props an element takes, what a prop allows, what an author
 * probably meant by a prop that does not exist, and the text `describe` prints.
 *
 * The did-you-mean has two halves, because there are two kinds of wrong. A
 * typo (`wdth`) is close to the right name, and edit distance finds it. A wrong
 * guess (`fill` on a `<text>`) is a perfectly good word from the wrong
 * vocabulary — CSS, SVG, another editor — and no amount of spelling will turn
 * it into `color`; those are an alias table, written down once here.
 */

// The attribute is what lets this module load under Node's own ESM loader too
// (a Vite config imports this package that way), not only through a bundler.
import data from "@posterract/composition/vocabulary.json" with { type: "json" };

export interface PropDefinition {
  /** The elements this definition of the prop holds for. */
  tags: string[];
  /** `number`, `string`, `boolean`, `time`, `enum`, or the type as TypeScript spells it. */
  type: string;
  /** The literal values an enumeration names. */
  values?: string[];
  required?: boolean;
  doc?: string;
  /** Editor view state an older source may carry; never authored. */
  view?: boolean;
  deprecated?: string | boolean;
}

export interface TagDefinition {
  doc?: string;
  /** A name SVG also has: under an `<svg>` it is SVG content, not this element. */
  svgInsideSvg?: boolean;
  props: string[];
}

export interface Vocabulary {
  version: number;
  sdk: string;
  /** Every prop name the runtime acts on, whatever element it is written on (see `isRuntimeProp`). */
  runtimeProps: string[];
  tags: Record<string, TagDefinition>;
  props: Record<string, PropDefinition[]>;
}

export const vocabulary = data as Vocabulary;

export const isVocabularyTag = (tag: string): boolean => Object.hasOwn(vocabulary.tags, tag);

const RUNTIME_PROPS: ReadonlySet<string> = new Set(vocabulary.runtimeProps);

/**
 * Whether the runtime does anything with a prop of this name. It applies props
 * by name alone, so it is more forgiving than the types: `fill` on a `<text>`
 * colors it exactly as `color` does, though `<text>` does not declare `fill`.
 * A name that is not even this is ignored outright.
 */
export const isRuntimeProp = (name: string): boolean => RUNTIME_PROPS.has(name);

/** What `name` means on `<tag>`, or undefined when that element has no such prop. */
export function propDefinition(tag: string, name: string): PropDefinition | undefined {
  return vocabulary.props[name]?.find((variant) => variant.tags.includes(tag));
}

/** The elements that do take `name`, for "not here, but there". */
export function tagsWithProp(name: string): string[] {
  return (vocabulary.props[name] ?? []).flatMap((variant) => variant.tags);
}

/**
 * What an author who wrote `from` most likely meant, as the name of a real
 * prop — or, where the vocabulary says it differently, a short instruction.
 * `*` applies to every element; an element's own entry wins over it.
 */
const ALIASES: Record<string, Record<string, string>> = {
  "*": {
    left: "x", top: "y", w: "width", h: "height", rotate: "rotation", angle: "rotation", alpha: "opacity",
    from: "start", begin: "start", to: "end", until: "end", in: "start", out: "end",
    duration: "`end` — an element is placed with `start` and `end`, not a duration",
    delay: "`start` — when the element begins",
    zIndex: "document order — a later element draws on top of an earlier one",
    visible: "`hidden` (the opposite sense)", display: "`hidden`", class: "`name`", className: "`name`", label: "name",
    radius: "cornerRadius", borderRadius: "cornerRadius", rx: "cornerRadius", ry: "cornerRadius",
    blend: "blendMode", mixBlendMode: "blendMode",
    stroke: "a `<stroke color=… width=… />` child element", strokeWidth: "a `<stroke width=… />` child element",
    strokeColor: "a `<stroke color=… />` child element", border: "a `<stroke />` child element",
    outline: "a `<stroke />` child element",
    shadow: "a `<shadow color=… blur=… />` child element", boxShadow: "a `<shadow />` child element",
    dropShadow: "a `<shadow />` child element", textShadow: "a `<shadow />` child element",
    filter: "an `<effect type=… value=… />` child element", blur: "an `<effect type=\"blur\" value=… />` child element",
    animate: "an `<animation type=… />` or `<keyframeTrack property=…>` child element",
    keyframes: "a `<keyframeTrack property=…>` child with `<keyframe>` children",
    transform: "`x`, `y`, `rotation`, `scale`", translateX: "offsetX", translateY: "offsetY",
    style: "individual props — composition elements take no `style`",
  },
  text: {
    fill: "color", fontColor: "color", textColor: "color", foreground: "color",
    size: "fontSize", font: "fontFamily", family: "fontFamily", weight: "fontWeight", bold: "`fontWeight=\"bold\"`",
    italic: "`fontStyle=\"italic\"`", align: "textAlign", justify: "textAlign", lineHeight: "leading",
    tracking: "letterSpacing", spacing: "letterSpacing", kerning: "letterSpacing", uppercase: "`textCase=\"upper\"`",
    textTransform: "textCase", underline: "`textDecoration=\"underline\"`", verticalAlign: "textBaseline",
    text: "the element's children — what a `<text>` says goes between its tags",
    content: "the element's children — what a `<text>` says goes between its tags",
    value: "the element's children — what a `<text>` says goes between its tags",
    maxWidth: "`width` — the width lines wrap at",
  },
  rect: { color: "fill", background: "fill", backgroundColor: "fill", bg: "fill" },
  scene: { color: "fill", background: "fill", backgroundColor: "fill", bg: "fill", fps: "the project's frame rate — a scene has none of its own", frameRate: "the project's frame rate — a scene has none of its own", length: "workarea" },
  group: { color: "fill", background: "fill", backgroundColor: "fill", gap: "`stagger` (time between children), or position the children" },
  ellipse: { color: "fill", background: "fill", r: "`width` and `height`", cx: "x", cy: "y" },
  path: { color: "fill", background: "fill", path: "d", points: "`d` (SVG path syntax)" },
  polygon: { color: "fill", background: "fill", d: "`points` (\"x,y x,y …\")" },
  stage: { color: "background", fill: "background", backgroundColor: "background", bg: "background" },
  video: {
    fit: "objectFit", source: "src", url: "src", href: "src", file: "src", path: "src",
    trimStart: "sourceIn", trimEnd: "sourceOut", trimIn: "sourceIn", trimOut: "sourceOut", startAt: "sourceIn", offset: "sourceIn",
    speed: "playbackRate", rate: "playbackRate", mute: "muted", gain: "volume", loop: "nothing — a clip does not loop; repeat the element",
  },
  image: { fit: "objectFit", source: "src", url: "src", href: "src", file: "src", path: "src", alt: "name" },
  audio: { source: "src", url: "src", href: "src", file: "src", path: "src", trimStart: "sourceIn", trimEnd: "sourceOut", speed: "playbackRate", mute: "muted", gain: "volume", level: "volume" },
  captions: { style: "preset", theme: "preset", transcript: "src", source: "src", position: "verticalAlign", align: "verticalAlign" },
  animation: { name: "type", preset: "type", kind: "type", direction: "phase", easing: "a `<keyframeTrack>` — presets take no easing", start: "delay" },
  keyframeTrack: { prop: "property", name: "property", target: "property", loop: "nothing yet — a track holds its last value; repeat the keyframes" },
  keyframe: { at: "time", t: "time", frame: "`time` (\"45f\" is frames)", v: "value", to: "value", ease: "easing", curve: "easing" },
  marker: { at: "time", t: "time", label: "name", text: "name", note: "name" },
  cue: { from: "start", to: "end", text: "the cue's children — what it says goes between its tags" },
  stroke: { size: "width", thickness: "width", weight: "width", lineWidth: "width", strokeWidth: "width", lineJoin: "join", lineCap: "cap" },
  shadow: { x: "offsetX", y: "offsetY", dx: "offsetX", dy: "offsetY", radius: "blur", spread: "blur", size: "blur" },
  effect: { name: "type", kind: "type", amount: "value", strength: "value", intensity: "value" },
  colorStop: { position: "offset", at: "offset", stop: "offset" },
  lottie: { source: "src", url: "src", path: "src", rate: "speed", playbackRate: "speed" },
};

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** The closest of `candidates` to `word`, when it is close enough to be a slip rather than another word. */
export function nearest(word: string, candidates: Iterable<string>): string | undefined {
  const lower = word.toLowerCase();
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score = distance(lower, candidate.toLowerCase());
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  // A slip changes a letter or two; more than a third of the word is another word.
  return best !== undefined && bestScore <= Math.max(1, Math.floor(word.length / 3)) ? best : undefined;
}

/**
 * What to say to an author who wrote `name` on `<tag>`, which has no such
 * prop: a real prop in backticks, or an instruction. Undefined when there is
 * nothing sensible to suggest.
 */
export function suggestProp(tag: string, name: string): string | undefined {
  const alias = ALIASES[tag]?.[name] ?? ALIASES["*"]?.[name];
  if (alias !== undefined) {
    // Anything but a bare name is an instruction, offered as written.
    if (!/^[A-Za-z]+$/.test(alias)) return alias;
    // A bare name is a prop; only offer it where it really exists.
    if (propDefinition(tag, alias)) return `\`${alias}\``;
  }
  const close = nearest(name, (vocabulary.tags[tag]?.props ?? []).filter((prop) => !propDefinition(tag, prop)?.view));
  return close === undefined ? undefined : `\`${close}\``;
}

function typeText(definition: PropDefinition): string {
  if (definition.type === "enum" && definition.values) return definition.values.map((value) => `"${value}"`).join(" | ");
  // Names plus an open form (an easing is a preset or `cubicBezier(…)`): the
  // names are what an author can pick from, so they are what is listed.
  if (definition.type === "enum | other" && definition.values) {
    return `${definition.values.map((value) => `"${value}"`).join(" | ")} | …`;
  }
  return definition.type;
}

/** The tasks an author arrives with, and the element that does each. Read before the alphabet. */
const HOW_TO: Array<[task: string, answer: string]> = [
  ["words on screen", "<text> — the words go between the tags; color is `color`"],
  ["captions from speech", "<captions src=transcript preset=…>, or <cue start end> children — stays editable text; never bake captions into images"],
  ["a clip, a picture, a sound", "<video> / <image> / <audio> with `src`, placed with `start` / `end`"],
  ["one thing after another", "<sequence> — children play back to back; `transition` on a child blends it into the next"],
  ["an entrance or exit", '<animation type="fade|slideUp|grow|…" phase="in|out"> as a child'],
  ["custom motion", '<keyframeTrack property="y"> with <keyframe time value easing> children'],
  ["word-by-word reveal", '<animation type="appearWord"> (or "appearChar", "scramble") inside a <text>'],
  ["outline, shadow, blur", "<stroke> / <shadow> / <effect> as children of the element"],
  ["a gradient", "<linearGradientPaint> with <colorStop> children, inside the shape"],
  ["a note for your collaborator", "<marker time name> — it shows on the timeline and lives in the file"],
];

/**
 * What `describe` prints. With no tag: every element in one line each, led by
 * the tasks authors arrive with. With a tag: its props, grouped so the ones
 * that are its own come before the ones every element shares.
 */
/** What an element to be created is made of, as an edit spells it. */
export interface ElementSpec {
  tag: string;
  props?: Record<string, unknown>;
  text?: string;
  children?: ElementSpec[];
}

/**
 * What is wrong with setting `props` on a `<tag>`, before anything is changed.
 *
 * The runtime ignores a prop name it does not know and the writer spells out
 * whatever it is handed, so without this a wrong guess — `speed` on a `<video>`
 * — does nothing on the canvas, is written into the source anyway, and is
 * reported as a success. `problems` are reasons to refuse the edit: a name
 * nothing reads, editor view state, a value an enumeration does not name, text
 * where a number goes. `warnings` go with an edit that is let through: a name
 * the runtime knows but the element does not document may well work (`fill` on
 * a `<text>` colors it as `color` would), and refusing what works would be a lie.
 */
export function checkProps(tag: string, id: string | undefined, props: Record<string, unknown>): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!isVocabularyTag(tag)) return { problems, warnings };
  const label = `<${tag}${id ? `#${id}` : ""}>`;

  for (const [name, value] of Object.entries(props)) {
    if (name === "id") continue;
    const definition = propDefinition(tag, name);
    if (!definition) {
      const suggestion = suggestProp(tag, name);
      const elsewhere = tagsWithProp(name);
      if (isRuntimeProp(name)) {
        warnings.push(
          `\`${name}\` is not a documented prop of ${label}; the runtime knows the name and may or may not act on it here, so check the result.` +
            (suggestion ? ` The documented prop is ${suggestion}.` : ""),
        );
        continue;
      }
      problems.push(
        `${label} has no prop \`${name}\`, and nothing in the runtime reads it.` +
          (suggestion
            ? ` Did you mean ${suggestion}?`
            : elsewhere.length
              ? ` It is a prop of ${elsewhere.slice(0, 5).map((other) => `<${other}>`).join(", ")}.`
              : ""),
      );
    } else if (definition.view) {
      problems.push(`\`${name}\` is editor view state, not part of the video; use \`posterract select\` / \`posterract show\` instead.`);
    } else if (definition.type === "enum" && typeof value === "string" && definition.values && !definition.values.includes(value)) {
      const close = nearest(value, definition.values);
      problems.push(
        `\`${name}\` on ${label} must be one of ${definition.values.map((entry) => `"${entry}"`).join(", ")}, not "${value}".` +
          (close ? ` Did you mean "${close}"?` : ""),
      );
    } else if (definition.type === "number" && typeof value !== "number" && value !== null && value !== false) {
      problems.push(`\`${name}\` on ${label} is a number, not ${JSON.stringify(value)}.`);
    }
  }
  return { problems, warnings };
}

/** `checkProps` for a whole tree to be created: every tag a real element, every prop one it takes. */
export function checkTree(element: ElementSpec): { problems: string[]; warnings: string[] } {
  if (!isVocabularyTag(element.tag)) {
    const close = nearest(element.tag, Object.keys(vocabulary.tags));
    return { problems: [`There is no <${element.tag}> element.${close ? ` Did you mean <${close}>?` : ""}`], warnings: [] };
  }
  const id = typeof element.props?.id === "string" ? element.props.id : undefined;
  const result = checkProps(element.tag, id, element.props ?? {});
  for (const child of element.children ?? []) {
    const inner = checkTree(child);
    result.problems.push(...inner.problems);
    result.warnings.push(...inner.warnings);
  }
  return result;
}

export function describeVocabulary(tag?: string): string[] {
  if (tag === undefined) {
    const width = Math.max(...Object.keys(vocabulary.tags).map((name) => name.length));
    return [
      `Posterract composition vocabulary · SDK ${vocabulary.sdk} · ${Object.keys(vocabulary.tags).length} elements`,
      "",
      "HOW DO I…",
      ...HOW_TO.map(([task, answer]) => `  ${task.padEnd(30)} ${answer}`),
      "",
      "ELEMENTS   (describe <element> lists its props)",
      ...Object.entries(vocabulary.tags).map(([name, entry]) =>
        `  ${name.padEnd(width)}  ${(entry.doc ?? "").replace(/^`<[^>]+>`\s*[—-]\s*/, "")}`),
    ];
  }

  const entry = vocabulary.tags[tag];
  if (!entry) {
    const close = nearest(tag, Object.keys(vocabulary.tags));
    throw new Error(`There is no <${tag}> element.${close ? ` Did you mean <${close}>?` : ""} Run describe with no argument for the list.`);
  }

  const authored = entry.props.filter((name) => !propDefinition(tag, name)?.view && name !== "children");
  // A prop defined for a handful of elements is this element's own; one that
  // nearly every element shares is the common furniture.
  const own = authored.filter((name) => (propDefinition(tag, name)?.tags.length ?? 0) <= 12);
  const shared = authored.filter((name) => !own.includes(name));
  const width = Math.max(...authored.map((name) => name.length));
  const line = (name: string): string => {
    const definition = propDefinition(tag, name)!;
    const flags = `${definition.required ? " (required)" : ""}${definition.deprecated ? " (deprecated)" : ""}`;
    return `  ${name.padEnd(width)}  ${typeText(definition)}${flags}${definition.doc ? ` — ${definition.doc}` : ""}`;
  };

  const timed = authored.some((name) => propDefinition(tag, name)?.type === "time");
  return [
    `<${tag}>${entry.doc ? `  ${entry.doc.replace(/^`<[^>]+>`\s*[—-]\s*/, "")}` : ""}`,
    ...(entry.svgInsideSvg ? [`  (inside an <svg>, <${tag}> is the SVG element instead)`] : []),
    "",
    ...(own.length ? ["ITS OWN", ...own.map(line), ""] : []),
    ...(shared.length ? ["SHARED WITH MOST ELEMENTS", ...shared.map(line)] : []),
    ...(timed ? ["", 'time = seconds as a number (1.5), or a string of frames ("45f") or a timecode ("01:30")'] : []),
  ];
}
