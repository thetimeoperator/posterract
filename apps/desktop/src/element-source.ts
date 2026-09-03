/**
 * Locating one stamped element's own JSX inside a project source file.
 *
 * The compiler stamps every element with a stable `id`, so an element can be
 * found by that id and its span read back out verbatim. This is what lets a
 * deleted scene be kept as the exact text the file had, and put back the same
 * way, without reconstructing it from the runtime.
 *
 * Deliberately textual: the source is the document, and a round-trip through
 * an AST would reformat everything around the element it was asked about.
 */

/** `<scene`, `<rect`, … — the tag an opening angle bracket starts, if any. */
const TAG_START = /<([A-Za-z][A-Za-z0-9]*)/;

function idAttributeIndex(content: string, id: string): number {
  // Match the attribute exactly, so `id="main"` is never found inside
  // `id="main-title"`, and accept both quote styles and `{"…"}` braces.
  for (const pattern of [`id="${id}"`, `id='${id}'`, `id={"${id}"}`, `id={'${id}'}`]) {
    const at = content.indexOf(pattern);
    if (at !== -1) return at;
  }
  return -1;
}

/**
 * Where an element is written, as a 1-based line number.
 *
 * Used to open the user's own editor at the element they clicked, so the
 * timeline and the file are two views of one thing rather than two documents.
 */
export function locateElement(content: string, id: string): { line: number; column: number } | null {
  const attribute = idAttributeIndex(content, id);
  if (attribute === -1) return null;
  const open = openingBracket(content, attribute);
  if (open === -1) return null;
  const before = content.slice(0, open);
  const line = before.split("\n").length;
  const column = open - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

/** The `<` that opens the element whose attribute list contains `from`. */
function openingBracket(content: string, from: number): number {
  const at = content.lastIndexOf("<", from);
  return at === -1 ? -1 : at;
}

/**
 * The element's full source span, including its children and closing tag.
 * Returns null when the element cannot be located unambiguously — the caller
 * must treat that as "cannot be preserved", never as an empty result.
 */
export function extractElementSource(content: string, id: string): string | null {
  const attribute = idAttributeIndex(content, id);
  if (attribute === -1) return null;

  const open = openingBracket(content, attribute);
  if (open === -1) return null;
  const tag = TAG_START.exec(content.slice(open))?.[1];
  if (!tag) return null;

  // Where the opening tag ends decides the shape: `/>` is the whole element,
  // otherwise its children run until the matching close.
  let cursor = open + 1;
  let quote: string | null = null;
  let braces = 0;
  for (; cursor < content.length; cursor += 1) {
    const char = content[cursor]!;
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braces += 1;
    else if (char === "}") braces -= 1;
    else if (char === ">" && braces === 0) break;
  }
  if (cursor >= content.length) return null;
  if (content[cursor - 1] === "/") return content.slice(open, cursor + 1);

  // Balance nested opens of the same tag so a scene inside a scene, or a
  // <rect> inside a <rect>, does not close the outer one early.
  const openTag = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  const closeTag = new RegExp(`</${tag}\\s*>`, "g");
  let depth = 1;
  let search = cursor + 1;
  while (depth > 0) {
    openTag.lastIndex = search;
    closeTag.lastIndex = search;
    const nextOpen = openTag.exec(content);
    const nextClose = closeTag.exec(content);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      search = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return content.slice(open, nextClose.index + nextClose[0].length);
    search = nextClose.index + nextClose[0].length;
  }
  return null;
}
