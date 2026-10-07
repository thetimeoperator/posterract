import { MAX_LEVEL, RANK_TIERS, RANK_TITLES } from "@posterract/contract";
import { TIER_MATERIALS } from "@/components/points/RankEmblem";
import { tierOf, type CardModel, type CardStat } from "./cardModel";

/**
 * The rank card, drawn on a canvas so the page, the saved image and every
 * frame of the posted video are the same picture.
 *
 * The card is a collectible: its metal edge is the creator's tier (a Silver
 * card has a silver edge, a Legendary one the white-green metal, the way
 * Ultimate Team cards are bronze, silver or gold), around the same emblem
 * and 270° gauge as the Points page. The rank sits in the top third; the
 * rest of the card is the numbers: points first, huge, then the readouts.
 * Nothing behind the panels glows; only the metal, the lines and the numbers
 * are lit.
 */

export const CARD_W = 900;
export const CARD_H = 1260;
export const STAGE_W = 1080;
export const STAGE_H = 1920;
/** Where the card sits on the 9:16 stage: inside Instagram's 3:4 grid crop, above the caption. */
const STAGE_CX = 540;
const STAGE_CY = 912;
export const VIDEO_SECONDS = 6;

const RADIUS = 46;
const INK = "#eafff3";
const DIM = "rgba(234,255,243,0.56)";
const HAIR = "rgba(234,255,243,0.13)";
const NEON = "#65ff9a";
const FACE = "#070b0d";
const STAGE = "#05080b";
const DISPLAY = '"Switzer", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

export type CardAssets = {
  emblem: CanvasImageSource;
  avatar?: CanvasImageSource;
  cover?: CanvasImageSource;
  /** The platform's logo, for a post or account card. */
  platform?: CanvasImageSource;
};

/** How far the face's animations have got, each 0 to 1. Settled is how the card rests. */
export type FaceState = {
  /** Numbers counting up. */
  count: number;
  /** The XP arc and the gauge. */
  gauge: number;
  /** The tier's title pips, lit one by one. */
  pips: number;
  /** A white flash along the edge as the card lands. */
  flash: number;
  /** The emblem's punch as it lands. */
  pulse: number;
  /** The tick ring's turn, in radians. */
  turn: number;
  /** A band of light crossing the card, -0.3 to 1.3 across; undefined for none. */
  sweep?: number;
};

export const SETTLED: FaceState = { count: 1, gauge: 1, pips: 1, flash: 0, pulse: 0, turn: 0 };

/** The fonts the card is set in, loaded before anything is drawn. */
export async function loadCardFonts() {
  await Promise.all([
    document.fonts.load(`italic 900 120px ${DISPLAY}`),
    document.fonts.load(`900 120px ${DISPLAY}`),
    document.fonts.load(`700 50px ${DISPLAY}`),
    document.fonts.load(`800 26px ${DISPLAY}`),
    document.fonts.load(`600 18px ${MONO}`),
  ]);
}

// ---------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = {
  outCubic: (u: number) => 1 - (1 - clamp(u)) ** 3,
  inOutCubic: (u: number) => {
    const x = clamp(u);
    return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  },
  outBack: (u: number) => {
    const x = clamp(u);
    const c = 1.7;
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
  },
};
const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Text with tracking, which canvas can't be trusted to do everywhere. */
function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number, align: "left" | "center" | "right" = "left") {
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const total = widths.reduce((sum, width) => sum + width, 0) + tracking * Math.max(0, chars.length - 1);
  let cursor = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const previous = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((char, index) => {
    ctx.fillText(char, cursor, y);
    cursor += widths[index]! + tracking;
  });
  ctx.textAlign = previous;
  return total;
}

/** The biggest size, up to `size`, at which `text` fits in `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number, font: (px: number) => string) {
  let px = size;
  ctx.font = font(px);
  const measured = ctx.measureText(text).width;
  if (measured > width) px = Math.floor((size * width) / measured);
  ctx.font = font(px);
  return px;
}

function formatStat(stat: CardStat, count: number) {
  const value = stat.value * count;
  let body: string;
  if (stat.format === "compact") {
    body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(stat.value) >= 1000 ? 1 : 0 }).format(value);
  } else if (stat.format === "points") {
    body = value.toLocaleString("en-US", { maximumFractionDigits: count < 1 ? 0 : 2 });
  } else {
    body = Math.round(value).toLocaleString("en-US");
  }
  return `${stat.prefix ?? ""}${body}${stat.suffix ?? ""}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(" ").length > out.join(" ").length) {
    let last = out[lines - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[lines - 1] = `${last.trimEnd()}…`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function material(model: CardModel) {
  return TIER_MATERIALS[tierOf(model.level).rank.tier];
}

/** Polished metal: the tier's metal in bands, light and dark, the way a lit edge catches the light. */
function polished(ctx: CanvasRenderingContext2D, metal: string[]) {
  const gradient = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  const [light, mid, low, dark] = [metal[0]!, metal[1]!, metal[metal.length - 2]!, metal[metal.length - 1]!];
  const bands = [light, mid, dark, low, light, mid, low, dark, mid, light];
  bands.forEach((color, index) => gradient.addColorStop(index / (bands.length - 1), color));
  return gradient;
}

/** The metal edge in the tier's material, a dark bevel, the hairline frame and its neon lock-on brackets. */
function drawFrame(ctx: CanvasRenderingContext2D, model: CardModel, flash: number) {
  const metal = material(model);
  ctx.lineWidth = 8;
  ctx.strokeStyle = polished(ctx, metal.metal);
  roundRect(ctx, 4, 4, CARD_W - 8, CARD_H - 8, RADIUS - 4);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  roundRect(ctx, 9, 9, CARD_W - 18, CARD_H - 18, RADIUS - 9);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `${metal.ink[1]}55`;
  roundRect(ctx, 11.5, 11.5, CARD_W - 23, CARD_H - 23, RADIUS - 11.5);
  ctx.stroke();

  const inset = 28;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HAIR;
  roundRect(ctx, inset, inset, CARD_W - inset * 2, CARD_H - inset * 2, RADIUS - inset + 10);
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = NEON;
  const arm = 48;
  const r = 18;
  for (const [x, y, sx, sy] of [
    [inset, inset, 1, 1],
    [CARD_W - inset, inset, -1, 1],
    [inset, CARD_H - inset, 1, -1],
    [CARD_W - inset, CARD_H - inset, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * arm);
    ctx.lineTo(x, y + sy * r);
    ctx.arcTo(x, y, x + sx * r, y, r);
    ctx.lineTo(x + sx * arm, y);
    ctx.stroke();
  }

  if (flash > 0.001) {
    ctx.lineWidth = 10;
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * flash})`;
    roundRect(ctx, 4, 4, CARD_W - 8, CARD_H - 8, RADIUS - 4);
    ctx.stroke();
  }
}

/** Text filled with the tier's metal, top to bottom, like the rank name on the Points page. */
function metalInk(ctx: CanvasRenderingContext2D, model: CardModel, top: number, bottom: number) {
  const metal = material(model);
  const ink = ctx.createLinearGradient(0, top, 0, bottom);
  ink.addColorStop(0, "#ffffff");
  ink.addColorStop(0.55, metal.ink[0]);
  ink.addColorStop(1, metal.ink[1]);
  return ink;
}

/**
 * The two corner readouts, the way a player card carries its rating: the
 * level, big, top left; the week's place (or the video's date) top right.
 */
function drawCorners(ctx: CanvasRenderingContext2D, model: CardModel, count: number) {
  ctx.textBaseline = "alphabetic";
  const level = String(Math.max(1, Math.round(model.level * count)));
  ctx.font = `italic 900 88px ${DISPLAY}`;
  ctx.fillStyle = metalInk(ctx, model, 62, 128);
  ctx.fillText(level, 66, 128);
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, "LEVEL", 72, 158, 5);

  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  fit(ctx, model.corner.value, 260, 58, (px) => `300 ${px}px ${DISPLAY}`);
  ctx.fillText(model.corner.value, CARD_W - 70, 118);
  ctx.textAlign = "left";
  ctx.fillStyle = material(model).ink[0];
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, model.corner.label.toUpperCase(), CARD_W - 72, 152, 4, "right");
}

/** The instrument ring around the emblem, as on the Points page: turning ticks, two sweeps, the tier's ten titles. */
function drawReticle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, model: CardModel, state: FaceState) {
  const metal = material(model);
  const { rank } = tierOf(model.level);
  const k = radius / 226;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(state.turn);
  for (let index = 0; index < 72; index += 1) {
    const major = index % 6 === 0;
    ctx.lineWidth = major ? 2.2 : 1.2;
    ctx.strokeStyle = major ? "rgba(101,255,154,0.55)" : "rgba(234,255,243,0.18)";
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, -radius + (major ? 18 : 10) * k);
    ctx.stroke();
    ctx.rotate(Math.PI / 36);
  }
  ctx.restore();

  const degrees = (value: number) => ((value - 90) * Math.PI) / 180;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.strokeStyle = NEON;
  for (const [from, to] of [[18, 50], [198, 230]] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 16 * k, degrees(from) + state.turn * 1.6, degrees(to) + state.turn * 1.6);
    ctx.stroke();
  }

  const start = degrees(-135);
  const sweep = (270 * Math.PI) / 180;
  const per = sweep / RANK_TITLES.length;
  const gap = (2 * Math.PI) / 180;
  ctx.lineCap = "butt";
  ctx.lineWidth = Math.max(6, 10 * k);
  for (let index = 0; index < RANK_TITLES.length; index += 1) {
    const lit = index <= rank.titleIndex && index / RANK_TITLES.length < state.gauge * ((rank.titleIndex + 1) / RANK_TITLES.length) + 1e-6;
    ctx.strokeStyle = !lit ? "rgba(234,255,243,0.1)" : index === rank.titleIndex ? NEON : metal.ink[1];
    ctx.beginPath();
    ctx.arc(cx, cy, 194 * k, start + index * per + gap, start + (index + 1) * per - gap);
    ctx.stroke();
  }
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(234,255,243,0.14)";
  ctx.beginPath();
  ctx.arc(cx, cy, 174 * k, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEmblem(ctx: CanvasRenderingContext2D, assets: CardAssets, cx: number, cy: number, size: number, pulse: number) {
  const scale = 1 + 0.09 * Math.sin(Math.PI * clamp(pulse));
  const s = size * scale;
  ctx.drawImage(assets.emblem, cx - s / 2, cy - s / 2, s, s);
}

/**
 * The rank, compact, in the top third: the emblem in its gauge on the left,
 * and beside it the name the way a baseball card sets a player's (the tier
 * spaced out small, the title big), over a line of where it sits.
 */
function drawRankBlock(ctx: CanvasRenderingContext2D, model: CardModel, assets: CardAssets, state: FaceState) {
  const { rank, tier, title } = tierOf(model.level);
  drawReticle(ctx, 212, 318, 124, model, state);
  drawEmblem(ctx, assets, 212, 316, 176, state.pulse);

  const x = 384;
  const width = CARD_W - 70 - x;
  ctx.fillStyle = DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, model.kicker.toUpperCase(), x, 236, 5);
  ctx.font = `800 28px ${DISPLAY}`;
  ctx.fillStyle = metalInk(ctx, model, 258, 282);
  tracked(ctx, tier.label.toUpperCase(), x + 2, 282, 12);
  const size = fit(ctx, title.toUpperCase(), width, 116, (px) => `italic 900 ${px}px ${DISPLAY}`);
  const baseline = 282 + 14 + size * 0.72;
  ctx.fillStyle = metalInk(ctx, model, baseline - size * 0.72, baseline);
  ctx.fillText(title.toUpperCase(), x - 4, baseline);
  ctx.fillStyle = DIM;
  ctx.font = `600 13px ${MONO}`;
  tracked(ctx, `TIER ${rank.tierIndex + 1} OF ${RANK_TIERS.length}  ·  ${title.toUpperCase()} ${rank.titleIndex + 1} OF ${RANK_TITLES.length}`, x, baseline + 40, 2);
}

/** A video card's top third: its cover, what it is, its title, and the creator's rank under them. */
function drawVideoBlock(ctx: CanvasRenderingContext2D, model: CardModel, assets: CardAssets, state: FaceState) {
  const post = model.post!;
  drawCover(ctx, assets, 70, 182, 236, 236);
  const x = 340;
  const width = CARD_W - 70 - x;
  const special = model.kicker !== `Posted on ${post.platformLabel}`;
  ctx.fillStyle = special ? NEON : DIM;
  ctx.font = `600 15px ${MONO}`;
  tracked(ctx, model.kicker.toUpperCase(), x, 206, 5);
  ctx.fillStyle = INK;
  ctx.font = `700 33px ${DISPLAY}`;
  const lines = wrap(ctx, post.title || "Untitled post", width, 3);
  lines.forEach((line, index) => ctx.fillText(line, x, 250 + index * 40));
  const rankY = 250 + (lines.length - 1) * 40 + 70;
  drawEmblem(ctx, assets, x + 27, rankY - 10, 58, state.pulse);
  ctx.font = `italic 900 27px ${DISPLAY}`;
  ctx.fillStyle = metalInk(ctx, model, rankY - 30, rankY);
  ctx.fillText(tierOf(model.level).rank.label.toUpperCase(), x + 66, rankY);
}

/** The number the card is about, huge and thin, under its spaced label. */
function drawHero(ctx: CanvasRenderingContext2D, model: CardModel, top: number, count: number) {
  ctx.fillStyle = DIM;
  ctx.font = `600 17px ${MONO}`;
  tracked(ctx, model.hero.label.toUpperCase(), 70, top + 52, 5);
  const final = formatStat(model.hero, 1);
  const px = fit(ctx, final, CARD_W - 140, 236, (size) => `300 ${size}px ${DISPLAY}`);
  const baseline = top + 52 + 28 + px * 0.72;
  ctx.fillStyle = model.hero.up ? NEON : INK;
  ctx.fillText(formatStat(model.hero, count), 62, baseline);
  return baseline;
}

/** The XP to the next level as a bar of cells, the lit ones neon, as on the Points page, and how far is left. */
function drawXp(ctx: CanvasRenderingContext2D, model: CardModel, y: number, lit: number) {
  const cells = 50;
  const width = CARD_W - 140;
  const gap = 3;
  const cell = (width - gap * (cells - 1)) / cells;
  const on = Math.round(clamp(model.progress) * cells * lit);
  for (let index = 0; index < cells; index += 1) {
    ctx.fillStyle = index < on ? NEON : "rgba(234,255,243,0.08)";
    ctx.fillRect(70 + index * (cell + gap), y, cell, 12);
  }
  if (on > 0 && on < cells) {
    ctx.fillStyle = INK;
    ctx.fillRect(70 + on * (cell + gap) - gap / 2 - 1, y - 5, 2, 22);
  }
  ctx.font = `600 14px ${MONO}`;
  ctx.fillStyle = DIM;
  const next = model.level < MAX_LEVEL ? tierOf(model.level + 1).rank.label.toUpperCase() : "TOP RANK";
  tracked(ctx, model.level < MAX_LEVEL ? `NEXT  ·  LEVEL ${model.level + 1}  ·  ${next}` : "LEVEL 100  ·  TOP RANK", 70, y + 44, 2.4);
  if (model.toNext !== undefined) {
    ctx.fillStyle = NEON;
    tracked(ctx, `${model.toNext.toLocaleString("en-US", { maximumFractionDigits: 2 })} PTS TO GO`, CARD_W - 70, y + 44, 2.4, "right");
  }
}

/**
 * Readouts in a grid of hairline cells, `columns` to a row (a wide one takes
 * a row of its own): a spaced label over a thin number, left-aligned in each.
 */
function drawGrid(ctx: CanvasRenderingContext2D, stats: CardStat[], top: number, bottom: number, columns: number, count: number) {
  const left = 70;
  const width = CARD_W - 140;
  const rows: CardStat[][] = [];
  for (const stat of stats) {
    const last = rows.at(-1);
    if (!last || stat.wide || last.length === columns || last[0]?.wide) rows.push([stat]);
    else last.push(stat);
  }
  const cellH = (bottom - top) / rows.length;
  rows.forEach((row, rowIndex) => {
    const y = top + rowIndex * cellH;
    const span = row[0]?.wide ? 1 : columns;
    const cellW = width / span;
    ctx.fillStyle = HAIR;
    ctx.fillRect(left, y, width, 1.5);
    row.forEach((stat, column) => {
      const x = left + column * cellW + (column > 0 ? 26 : 0);
      if (column > 0) {
        ctx.fillStyle = HAIR;
        ctx.fillRect(left + column * cellW, y + 22, 1.5, cellH - 44);
      }
      ctx.fillStyle = DIM;
      ctx.font = `600 15px ${MONO}`;
      tracked(ctx, stat.label.toUpperCase(), x, y + 46, 4);
      const px = fit(ctx, formatStat(stat, 1), cellW - 40, Math.min(118, cellH - 62), (size) => `300 ${size}px ${DISPLAY}`);
      ctx.font = `300 ${px}px ${DISPLAY}`;
      ctx.fillStyle = stat.up ? NEON : INK;
      ctx.fillText(formatStat(stat, count), x - 4, y + 46 + 20 + px * 0.72);
    });
  });
}

function drawFooter(ctx: CanvasRenderingContext2D, model: CardModel, assets: CardAssets) {
  const y = 1168;
  ctx.fillStyle = HAIR;
  ctx.fillRect(70, 1110, CARD_W - 140, 1.5);
  let x = 72;
  const r = 25;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y, r, 0, Math.PI * 2);
  ctx.clip();
  if (assets.avatar) {
    ctx.drawImage(assets.avatar, x, y - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#101a17";
    ctx.fillRect(x, y - r, r * 2, r * 2);
    ctx.fillStyle = INK;
    ctx.font = `800 18px ${DISPLAY}`;
    ctx.textAlign = "center";
    const initials = model.player.name.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
    ctx.fillText(initials || "P", x + r, y + 6.5);
    ctx.textAlign = "left";
  }
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = material(model).ink[1];
  ctx.beginPath();
  ctx.arc(x + r, y, r + 3.5, 0, Math.PI * 2);
  ctx.stroke();
  x += r * 2 + 20;
  ctx.fillStyle = INK;
  fit(ctx, model.player.name, 380, 27, (px) => `700 ${px}px ${DISPLAY}`);
  ctx.fillText(model.player.name, x, model.player.handle ? y - 3 : y + 9);
  if (model.player.handle) {
    ctx.fillStyle = DIM;
    ctx.font = `500 16px ${MONO}`;
    ctx.fillText(model.player.handle, x, y + 21);
  }
  ctx.fillStyle = INK;
  ctx.font = `800 22px ${DISPLAY}`;
  tracked(ctx, "POSTERRACT", CARD_W - 72, y - 2, 7, "right");
  ctx.fillStyle = NEON;
  ctx.font = `600 14px ${MONO}`;
  tracked(ctx, "POSTERRACT.APP", CARD_W - 72, y + 22, 2.2, "right");
}

/** A video's cover, framed like a print, with its platform's mark. */
function drawCover(ctx: CanvasRenderingContext2D, assets: CardAssets, x: number, y: number, w: number, h: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 20);
  ctx.clip();
  ctx.fillStyle = "#0d1513";
  ctx.fillRect(x, y, w, h);
  if (assets.cover) {
    const image = assets.cover as HTMLImageElement;
    const iw = image.naturalWidth || image.width || w;
    const ih = image.naturalHeight || image.height || h;
    const scale = Math.max(w / iw, h / ih);
    ctx.drawImage(assets.cover, x + (w - iw * scale) / 2, y + (h - ih * scale) / 2, iw * scale, ih * scale);
  }
  const shade = ctx.createLinearGradient(0, y + h * 0.55, 0, y + h);
  shade.addColorStop(0, "rgba(5,8,11,0)");
  shade.addColorStop(1, "rgba(5,8,11,0.78)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(234,255,243,0.22)";
  roundRect(ctx, x, y, w, h, 20);
  ctx.stroke();
  if (assets.platform) ctx.drawImage(assets.platform, x + 14, y + h - 54, 40, 40);
}

function drawSweep(ctx: CanvasRenderingContext2D, sweep: number) {
  const x = -CARD_W * 0.6 + sweep * CARD_W * 2;
  const band = ctx.createLinearGradient(x - 260, 0, x + 260, CARD_H * 0.35);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.10)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

/** Where the top third ends and the numbers begin. */
const STATS_TOP = 448;

/** The face of a card, in card units (CARD_W × CARD_H), as it looks at `state`. */
export function drawCardFace(ctx: CanvasRenderingContext2D, model: CardModel, assets: CardAssets, state: FaceState = SETTLED) {
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.clip();
  ctx.fillStyle = FACE;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.textBaseline = "alphabetic";
  drawCorners(ctx, model, state.count);
  if (model.kind === "rank") drawRankBlock(ctx, model, assets, state);
  else drawVideoBlock(ctx, model, assets, state);

  ctx.fillStyle = HAIR;
  ctx.fillRect(70, STATS_TOP, CARD_W - 140, 1.5);
  const heroBaseline = drawHero(ctx, model, STATS_TOP, state.count);
  if (model.kind === "rank") {
    drawXp(ctx, model, heroBaseline + 30, state.gauge);
    drawGrid(ctx, model.stats, heroBaseline + 100, 1092, 2, state.count);
  } else {
    drawGrid(ctx, model.stats, heroBaseline + 40, 1090, 2, state.count);
  }
  drawFooter(ctx, model, assets);
  if (state.sweep !== undefined) drawSweep(ctx, state.sweep);
  ctx.restore();
  drawFrame(ctx, model, state.flash);
}

/** The back: the metal edge, a reticle and the wordmark. It shows for a moment as the card turns. */
export function drawCardBack(ctx: CanvasRenderingContext2D, model: CardModel) {
  ctx.save();
  roundRect(ctx, 0, 0, CARD_W, CARD_H, RADIUS);
  ctx.clip();
  ctx.fillStyle = FACE;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = "rgba(234,255,243,0.14)";
  ctx.lineWidth = 1.5;
  for (const r of [300, 250]) {
    ctx.beginPath();
    ctx.arc(CARD_W / 2, CARD_H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.font = `800 52px ${DISPLAY}`;
  tracked(ctx, "POSTERRACT", CARD_W / 2, CARD_H / 2 + 18, 14, "center");
  ctx.fillStyle = material(model).ink[0];
  ctx.font = `600 18px ${MONO}`;
  tracked(ctx, "RANK CARD", CARD_W / 2, CARD_H / 2 + 78, 6, "center");
  ctx.restore();
  drawFrame(ctx, model, 0);
}

// ---------------------------------------------------------------------------
// The stage: the 9:16 video, the card turning over and landing
// ---------------------------------------------------------------------------

export type StageTextures = { face: HTMLCanvasElement; back: HTMLCanvasElement; sample: HTMLCanvasElement };

export function makeTextures(model: CardModel): StageTextures {
  const canvas = (width: number, height: number) => {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    return element;
  };
  const textures = { face: canvas(CARD_W, CARD_H), back: canvas(CARD_W, CARD_H), sample: canvas(STAGE_W, STAGE_H) };
  drawCardBack(textures.back.getContext("2d")!, model);
  return textures;
}

/** The card's motion over the video: angle (degrees about its upright axis), scale, rise, and the face's state. */
export function cardMotion(t: number): { angle: number; scale: number; rise: number; face: FaceState; blur: boolean } {
  // 0–0.15 s: still, the cover frame. Then a wind-up, a full turn, a landing.
  const windUp = ease.inOutCubic(span(t, 0.15, 0.45));
  const turn = ease.inOutCubic(span(t, 0.45, 1.25));
  let angle = -14 * windUp + (360 + 14) * turn;
  let scale = 1 - 0.04 * windUp + 0.04 * turn;
  // After landing it floats, turning a few degrees either way.
  const idle = Math.max(0, t - 2.3);
  if (idle > 0) angle += 6 * Math.sin((idle / 3.6) * Math.PI * 2) * ease.outCubic(span(t, 2.3, 3.1));
  const rise = idle > 0 ? 7 * Math.sin((idle / 3.6) * Math.PI * 2 + Math.PI / 2) * ease.outCubic(span(t, 2.3, 3.1)) : 0;
  const landed = t >= 1.25;
  // The numbers reset while the back is showing, and count up once the card lands.
  const reset = t >= 0.85;
  const count = !reset ? 1 : landed ? ease.outCubic(span(t, 1.3, 2.3)) : 0;
  const face: FaceState = {
    count,
    gauge: !reset ? 1 : ease.outCubic(span(t, 1.3, 2.2)),
    pips: !reset ? 1 : span(t, 1.4, 2.2),
    flash: landed ? Math.max(0, 1 - (t - 1.25) / 0.45) : 0,
    pulse: span(t, 1.25, 1.55),
    turn: t * 0.07,
    sweep: t >= 3.0 && t <= 4.1 ? -0.3 + ((t - 3.0) / 1.1) * 1.6 : undefined,
  };
  scale *= landed ? 1 + 0.03 * Math.sin(Math.PI * span(t, 1.25, 1.5)) : 1;
  return { angle, scale, rise, face, blur: t > 0.5 && t < 1.25 };
}

/** The card drawn in perspective, turned `angle` degrees about its upright axis, as thin vertical strips. */
function drawTurned(ctx: CanvasRenderingContext2D, textures: StageTextures, angle: number, cx: number, cy: number, scale: number) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const back = cos < 0;
  const source = back ? textures.back : textures.face;
  const strips = 96;
  const step = CARD_W / strips;
  const distance = 2600;
  // A column of the texture, as a distance from the card's middle: seen from behind, the back runs the other way.
  const local = (u: number) => (back ? CARD_W / 2 - u : u - CARD_W / 2);
  const project = (u: number) => {
    const x = local(u);
    const perspective = distance / (distance + x * sin);
    return { x: cx + x * cos * perspective * scale, p: perspective };
  };
  for (let index = 0; index < strips; index += 1) {
    const a = project(index * step);
    const b = project((index + 1) * step);
    const left = Math.min(a.x, b.x);
    const width = Math.abs(b.x - a.x) + 0.75;
    const height = CARD_H * ((a.p + b.p) / 2) * scale;
    if (width < 0.05) continue;
    ctx.drawImage(source, index * step, 0, step, CARD_H, left, cy - height / 2, width, height);
  }
}

/** One frame of the video at `t` seconds. */
export function drawStageFrame(ctx: CanvasRenderingContext2D, model: CardModel, assets: CardAssets, textures: StageTextures, t: number) {
  const motion = cardMotion(t);
  const faceCtx = textures.face.getContext("2d")!;
  faceCtx.clearRect(0, 0, CARD_W, CARD_H);
  drawCardFace(faceCtx, model, assets, motion.face);
  ctx.fillStyle = STAGE;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  if (!motion.blur) {
    drawTurned(ctx, textures, motion.angle, STAGE_CX, STAGE_CY - motion.rise, motion.scale);
    return;
  }
  // Motion blur while it spins: whole frames from across the shutter, averaged.
  const sampleCtx = textures.sample.getContext("2d")!;
  const samples = 6;
  for (let sample = 0; sample < samples; sample += 1) {
    const at = cardMotion(t + (sample / (samples - 1) - 0.5) * (1 / 30) * 0.7);
    sampleCtx.fillStyle = STAGE;
    sampleCtx.fillRect(0, 0, STAGE_W, STAGE_H);
    drawTurned(sampleCtx, textures, at.angle, STAGE_CX, STAGE_CY - at.rise, at.scale);
    ctx.globalAlpha = 1 / (sample + 1);
    ctx.drawImage(textures.sample, 0, 0);
  }
  ctx.globalAlpha = 1;
}

/** The video's sound, timed to the motion. */
export const STAGE_SOUND = [
  { at: 0.42, kind: "whoosh" as const },
  { at: 1.25, kind: "impact" as const },
  ...Array.from({ length: 7 }, (_, index) => ({ at: 1.4 + index * 0.13, kind: "tick" as const })),
  { at: 2.3, kind: "shimmer" as const },
];
