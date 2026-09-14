// Builds src/styles/landing-cyan.css: a copy of the landing stylesheets scoped
// under .site[data-palette="cyan"], with each green hue turned cyan-blue in
// OKLCH (lightness and chroma kept, gamut-clamped). Every rule is copied, not
// only the coloured ones, so the cascade under the scope is the original
// cascade: a later "border: 0" still beats an earlier coloured border. The
// originals are not touched, so product mode cannot change. Run after editing
// any of the source stylesheets:
//   node scripts/cyan-theme.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES = ["homepage.css", "homepage-readability.css", "landing-two-mode.css"];
const OUT = resolve(here, "../src/styles/landing-cyan.css");
const SCOPE = '.site[data-palette="cyan"]';

/** The green accent and what it becomes; every other green moves by the same hue. */
const ACCENT_FROM = "#65ff9a";
const ACCENT_TO = "#5fdcff";
/** OKLCH hues that count as green (the accent sits near 150). */
const GREEN = [105, 180];

// ---- colour maths (sRGB <-> OKLCH) ----------------------------------------
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklch([r, g, b]) {
  const [R, G, B] = [lin(r / 255), lin(g / 255), lin(b / 255)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { L, C, h };
}
function fromOklch({ L, C, h }) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const bb = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
/** Back to 0-255 sRGB, lowering chroma until the colour fits. */
function toRgb(lch) {
  let { C } = lch;
  let rgb = fromOklch(lch);
  let lo = 0;
  let hi = C;
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      rgb = fromOklch({ ...lch, C: mid });
      if (inGamut(rgb)) lo = mid;
      else hi = mid;
    }
    rgb = fromOklch({ ...lch, C: lo });
  }
  return rgb.map((c) => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, c))))) * 255));
}
function hex(value) {
  let v = value.slice(1);
  if (v.length === 3 || v.length === 4) v = [...v].map((ch) => ch + ch).join("");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
const FROM = toOklch(hex(ACCENT_FROM));
const TO = toOklch(hex(ACCENT_TO));
const SHIFT = (TO.h - FROM.h + 360) % 360;
/** Cyan-blue cannot be as light as neon green at the same chroma: the accent's drop, scaled by each colour's chroma. */
const DROP = FROM.L - TO.L;
function shift(rgb) {
  const lch = toOklch(rgb);
  if (lch.C < 0.003) return rgb; // grey: no hue to speak of
  if (lch.h < GREEN[0] || lch.h > GREEN[1]) return rgb;
  const weight = Math.min(1, lch.C / FROM.C);
  return toRgb({ L: lch.L - DROP * weight, C: lch.C, h: (lch.h + SHIFT) % 360 });
}

// ---- colour tokens inside a declaration value ------------------------------
const TOKEN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^()]*\)/gi;
let changed = 0;
function recolour(value) {
  return value.replace(TOKEN, (token) => {
    if (token.startsWith("#")) {
      const digits = token.slice(1);
      const alpha = digits.length === 8 ? digits.slice(6) : digits.length === 4 ? digits[3] + digits[3] : "";
      const rgb = hex(token);
      const next = shift(rgb);
      if (next === rgb) return token;
      changed += 1;
      return `#${next.map((c) => c.toString(16).padStart(2, "0")).join("")}${alpha}`;
    }
    const inner = token.slice(token.indexOf("(") + 1, -1).trim();
    const parts = inner.split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.slice(0, 3).some((p) => !/^\d+(\.\d+)?$/.test(p))) return token;
    const rgb = parts.slice(0, 3).map(Number);
    const next = shift(rgb);
    if (next === rgb) return token;
    changed += 1;
    const alpha = parts[3];
    const commas = inner.includes(",");
    if (alpha === undefined) return commas ? `rgb(${next.join(", ")})` : `rgb(${next.join(" ")})`;
    return commas ? `rgba(${next.join(", ")}, ${alpha})` : `rgb(${next.join(" ")} / ${alpha})`;
  });
}

// ---- a small CSS walker ----------------------------------------------------
const HAS_TOKEN = new RegExp(TOKEN.source, "i");
function parseBlock(text) {
  const nodes = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") depth -= 1;
      j += 1;
    }
    const prelude = text.slice(i, open).trim().replace(/^[;\s]+/, "");
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (!prelude) continue;
    if (/^@(media|supports|container|layer)\b/.test(prelude)) nodes.push({ at: prelude, children: parseBlock(body) });
    else if (prelude.startsWith("@")) {
      if (/^@keyframes/.test(prelude) && HAS_TOKEN.test(body)) console.warn(`keyframes with colours, left alone: ${prelude}`);
      continue;
    } else nodes.push({ selector: prelude, body });
  }
  return nodes;
}
function declarations(body) {
  const out = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(":");
      return { prop: d.slice(0, colon).trim(), value: d.slice(colon + 1).trim() };
    })
    .filter((d) => d.prop && !d.prop.startsWith("/"));
}
function scope(selector) {
  return selector
    .split(",")
    .map((s) => s.trim())
    .map((s) => {
      if (/^\.site(?![-\w])/.test(s)) return s.replace(/^\.site/, SCOPE);
      if (/^(html|body|:root)\b/.test(s)) return null;
      return `${SCOPE} ${s}`;
    })
    .filter(Boolean)
    .join(",\n");
}
function emit(nodes, indent = "") {
  let css = "";
  for (const node of nodes) {
    if (node.at) {
      const inner = emit(node.children, `${indent}  `);
      if (inner.trim()) css += `${indent}${node.at} {\n${inner}${indent}}\n\n`;
      continue;
    }
    const decls = declarations(node.body);
    if (decls.length === 0) continue;
    const selector = scope(node.selector);
    if (!selector) continue;
    css += `${indent}${selector.split("\n").join(`\n${indent}`)} {\n`;
    for (const d of decls) css += `${indent}  ${d.prop}: ${recolour(d.value)};\n`;
    css += `${indent}}\n\n`;
  }
  return css;
}

let out = `/* Generated by scripts/cyan-theme.mjs from ${SOURCES.join(", ")}. Do not edit: rerun the script. */\n/* Work mode's palette: the landing's rules under .site[data-palette="cyan"], every green turned cyan-blue (${ACCENT_FROM} -> ${ACCENT_TO}). */\n\n`;
for (const file of SOURCES) {
  const text = readFileSync(resolve(here, "../src/styles", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  out += `/* ---- ${file} ---- */\n\n${emit(parseBlock(text))}`;
}
writeFileSync(OUT, out);
console.log(`wrote ${OUT}: ${out.split("\n").length} lines, ${changed} colours turned`);

// The shader world's palette, for LandingIntroWorld.
const WORLD = [[0.1216, 1, 0.3961], [0.3961, 1, 0.6039], [0.6588, 0.9647, 1]];
console.log("shader palette:", WORLD.map((c) => shift(c.map((v) => Math.round(v * 255))).map((v) => +(v / 255).toFixed(4))));
console.log("accent lands on:", `#${shift(hex(ACCENT_FROM)).map((c) => c.toString(16).padStart(2, "0")).join("")}`, "wanted", ACCENT_TO, "shift:", SHIFT.toFixed(1), "deg; e.g.", ["#eafff3", "#8aab98", "#0a2e1c", "#82998b", "#a8f6ff"].map((h) => `${h}->#${shift(hex(h)).map((c) => c.toString(16).padStart(2, "0")).join("")}`).join(" "));
