/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The composition vocabulary as data: every element, every prop it takes, what
 * values a prop allows, and one sentence about each — generated from the types
 * in src/, which are the one place the vocabulary is defined.
 *
 * TypeScript knows all of this, but only TypeScript does: nothing at runtime
 * can enumerate what `<text>` accepts, so nothing can tell an author that
 * `fill` on a `<text>` does nothing (it is `color`), and nothing can answer
 * "what can I write here?" without reading a thousand lines of types. This
 * file is that knowledge, resolved once: `describe` prints it, the compiler's
 * lint checks sources against it, and the edit tools validate with it.
 *
 *   node scripts/vocabulary.mjs           writes vocabulary.json
 *   node scripts/vocabulary.mjs --check   exits 1 when vocabulary.json is stale
 *
 * The check runs in the package's tests, so the file cannot drift from the
 * types it was generated from.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(packageDir, "vocabulary.json");

/** Props that address or wire an element rather than describe it. */
const WIRING_PROPS = new Set(["ref"]);

/** Editor view state an older source may still carry; never authored (see types.ts). */
const VIEW_PROPS = new Set(["selected", "active", "expanded", "clipHeight", "camera"]);

/** One sentence: what a reader needs in a listing. The types keep the rest. */
function firstSentence(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);
  return sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence;
}

function loadProgram() {
  const configPath = join(packageDir, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageDir);
  return ts.createProgram({
    rootNames: [join(packageDir, "src", "jsx-runtime.ts")],
    options: { ...parsed.options, noEmit: true },
  });
}

/** How a prop's type reads to an author, and the literal values it allows when it is an enumeration. */
function describeType(checker, type) {
  const parts = type.isUnion() ? type.types : [type];
  const defined = parts.filter((part) => !(part.flags & ts.TypeFlags.Undefined));

  const literals = defined.filter((part) => part.isStringLiteral());
  const onlyStrings = literals.length > 0 && literals.length === defined.length;
  if (onlyStrings) return { type: "enum", values: literals.map((part) => part.value) };

  // `true | false` is how the checker spells boolean.
  if (defined.length > 0 && defined.every((part) => part.flags & ts.TypeFlags.BooleanLike)) return { type: "boolean" };
  if (defined.length === 1 && defined[0].flags & ts.TypeFlags.NumberLike) return { type: "number" };
  if (defined.length === 1 && defined[0].flags & ts.TypeFlags.String) return { type: "string" };

  const text = checker.typeToString(
    checker.getUnionType(defined),
    undefined,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
  // `Time`: seconds, frames (`"45f"`) or a timecode (`"01:30"`).
  if (/`\$\{number\}f`/.test(text)) return { type: "time" };
  // An enumeration that also accepts a fallback string still lists what it names.
  if (literals.length >= 2) return { type: text.length > 120 ? "enum | other" : text, values: literals.map((part) => part.value) };
  return { type: text.length > 160 ? `${text.slice(0, 157)}…` : text };
}

/**
 * Every prop name the runtime acts on, whatever element it is written on.
 *
 * The types say what each element is *documented* to take; the runtime is more
 * forgiving — it applies a prop by name alone, so `fill` on a `<text>` sets
 * its color exactly as `color` does, though `<text>` does not declare it. The
 * two lists answer different questions, and a check that wants to be truthful
 * needs both: a name in neither is ignored outright (an error); a name the
 * runtime knows but the element does not declare works today and is outside
 * the contract (a warning). Read off the one switch that applies props.
 */
function runtimeProps() {
  const reconciler = join(packageDir, "..", "posterract-video-reconciler", "src", "document.ts");
  const source = readFileSync(reconciler, "utf8");
  const start = source.indexOf("public setProperty(");
  if (start === -1) throw new Error("RuntimeDocument.setProperty was not found in the reconciler");
  // The method ends where the next member of the class begins.
  const end = source.indexOf("\n\t/**", source.indexOf("default:", start));
  const body = source.slice(start, end === -1 ? undefined : end);
  const names = new Set([...body.matchAll(/case '([A-Za-z][A-Za-z0-9]*)':/g)].map((match) => match[1]));
  if (names.size < 50) throw new Error(`Only ${names.size} runtime props were found; the reconciler's shape has changed`);
  return [...names].sort();
}

function build() {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(join(packageDir, "src", "jsx-runtime.ts"));
  if (!source) throw new Error("src/jsx-runtime.ts is not part of the program");

  /** @type {ts.InterfaceDeclaration | undefined} */
  let intrinsics;
  const find = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "IntrinsicElements") intrinsics = node;
    else ts.forEachChild(node, find);
  };
  find(source);
  if (!intrinsics) throw new Error("JSX.IntrinsicElements was not found");

  const tags = {};
  for (const member of intrinsics.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) continue;
    const tag = member.name.text;

    // A name both vocabularies share (`rect`, `text`, …) is typed as the union
    // of its two readings; the composition's is the one built on SourceProps.
    const readings = ts.isUnionTypeNode(member.type) ? member.type.types : [member.type];
    const node = readings.find((reading) => /\bSourceProps\b/.test(reading.getText(source)));
    if (!node) continue; // `img`, and anything else that is DOM only.
    const shared = readings.length > 1;

    const type = checker.getTypeFromTypeNode(node);
    const props = {};
    for (const symbol of checker.getPropertiesOfType(type)) {
      const name = symbol.getName();
      if (WIRING_PROPS.has(name) || name.startsWith("__")) continue;

      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      const propType = checker.getTypeOfSymbolAtLocation(symbol, declaration ?? member);
      const deprecated = symbol.getJsDocTags(checker).find((entry) => entry.name === "deprecated");
      const doc = firstSentence(ts.displayPartsToString(symbol.getDocumentationComment(checker)));

      props[name] = {
        ...describeType(checker, propType),
        ...(symbol.flags & ts.SymbolFlags.Optional ? {} : { required: true }),
        ...(doc ? { doc } : {}),
        ...(VIEW_PROPS.has(name) ? { view: true } : {}),
        ...(deprecated ? { deprecated: firstSentence(ts.displayPartsToString(deprecated.text)) || true } : {}),
      };
    }

    // The element's own sentence: the doc on the props type it is declared with.
    const reference = [];
    const collect = (candidate) => {
      if (ts.isTypeReferenceNode(candidate) && ts.isIdentifier(candidate.typeName)) reference.push(candidate.typeName);
      ts.forEachChild(candidate, collect);
    };
    collect(node);
    const propsName = reference.find((identifier) => identifier.text !== "SourceProps");
    let doc = "";
    if (propsName) {
      const alias = checker.getSymbolAtLocation(propsName);
      const target = alias && alias.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(alias) : alias;
      if (target) doc = firstSentence(ts.displayPartsToString(target.getDocumentationComment(checker)));
    }

    tags[tag] = {
      ...(doc ? { doc } : {}),
      ...(shared ? { svgInsideSvg: true } : {}),
      props: Object.fromEntries(Object.entries(props).sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  // Most props are shared — `x` means the same on thirty elements — so each
  // distinct definition is written once, with the elements it holds for, and
  // an element lists its props by name. `props.fill` then also answers "where
  // is `fill` valid?", which is what a did-you-mean needs.
  const definitions = {};
  for (const [tag, entry] of Object.entries(tags)) {
    for (const [name, definition] of Object.entries(entry.props)) {
      const variants = (definitions[name] ??= []);
      const key = JSON.stringify(definition);
      let variant = variants.find((candidate) => candidate.key === key);
      if (!variant) variants.push((variant = { key, tags: [], definition }));
      variant.tags.push(tag);
    }
  }

  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  return {
    version: 1,
    sdk: pkg.version,
    runtimeProps: runtimeProps(),
    tags: Object.fromEntries(
      Object.entries(tags).map(([tag, entry]) => [tag, { ...entry, props: Object.keys(entry.props) }]),
    ),
    props: Object.fromEntries(
      Object.entries(definitions)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, variants]) => [name, variants.map(({ tags: on, definition }) => ({ tags: on, ...definition }))]),
    ),
  };
}

const serialized = `${JSON.stringify(build(), null, 1)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== serialized) {
    console.error("vocabulary.json is out of date with src/types.ts — run `pnpm --filter @posterract/composition vocabulary`.");
    process.exit(1);
  }
  console.log("vocabulary.json is up to date.");
} else {
  writeFileSync(outputPath, serialized);
  const vocabulary = JSON.parse(serialized);
  const tagCount = Object.keys(vocabulary.tags).length;
  const propCount = Object.values(vocabulary.tags).reduce((sum, tag) => sum + tag.props.length, 0);
  const distinct = Object.values(vocabulary.props).reduce((sum, variants) => sum + variants.length, 0);
  console.log(
    `vocabulary.json: ${tagCount} elements, ${propCount} props (${distinct} distinct definitions), ${serialized.length.toLocaleString("en-US")} bytes`,
  );
}
