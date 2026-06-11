/**
 * 4D hypercube mathematics for the Tesseract.
 *
 * The hypercube has 16 vertices (±1,±1,±1,±1), 32 edges, and 8 cubic cells.
 * The 6 "axis" cells (x±, y±, z±) are the six platform portals; the w− cell
 * is the inner cube (the artifact/Vault) and the w+ cell is the outer frame
 * (the Forge). Posterract's whole visual thesis lives in this file.
 */
import type { PlatformId } from "@posterract/contract";

export type Vec4 = [number, number, number, number];
export type Vec3 = [number, number, number];

export type CellId = "x+" | "x-" | "y+" | "y-" | "z+" | "z-" | "w+" | "w-";

export const CELL_IDS: CellId[] = ["x+", "x-", "y+", "y-", "z+", "z-", "w+", "w-"];

/** The six platform portals mapped onto the six axis cells. */
export const PLATFORM_CELLS: Record<PlatformId, CellId> = {
  instagram: "x+",
  tiktok: "x-",
  youtube: "y+",
  x: "y-",
  threads: "z+",
  facebook: "z-",
};

export const CELL_PLATFORMS: Partial<Record<CellId, PlatformId>> = Object.fromEntries(
  Object.entries(PLATFORM_CELLS).map(([p, c]) => [c, p as PlatformId]),
) as Partial<Record<CellId, PlatformId>>;

/** 16 hypercube vertices; index bit i ⇒ coordinate i is +1. */
export const VERTS_4D: Vec4[] = Array.from({ length: 16 }, (_, i) => [
  i & 1 ? 1 : -1,
  i & 2 ? 1 : -1,
  i & 4 ? 1 : -1,
  i & 8 ? 1 : -1,
]);

/** Pairs of vertex indices differing in exactly one bit (32 edges). */
export const EDGES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++)
    for (let j = i + 1; j < 16; j++) {
      const d = i ^ j;
      if ((d & (d - 1)) === 0) out.push([i, j]);
    }
  return out;
})();

const AXIS_INDEX: Record<"x" | "y" | "z" | "w", number> = { x: 0, y: 1, z: 2, w: 3 };

/** The 8 vertex indices belonging to a cell (fixed coordinate = ±1). */
export function cellVertexIndices(cell: CellId): number[] {
  const axis = AXIS_INDEX[cell[0] as "x" | "y" | "z" | "w"];
  const sign = cell[1] === "+" ? 1 : -1;
  const out: number[] = [];
  for (let i = 0; i < 16; i++) {
    const coord = i & (1 << axis) ? 1 : -1;
    if (coord === sign) out.push(i);
  }
  return out; // always 8
}

/** The 12 edges of a cell, as index pairs into that cell's own vertex list. */
export function cellEdges(cell: CellId): Array<[number, number]> {
  const verts = cellVertexIndices(cell);
  const local = new Map(verts.map((v, i) => [v, i]));
  const out: Array<[number, number]> = [];
  for (const [a, b] of EDGES) {
    if (local.has(a) && local.has(b)) out.push([local.get(a)!, local.get(b)!]);
  }
  return out; // always 12
}

/**
 * Rotate a 4D point in the XW and YZ planes (the classic "double rotation"
 * that makes the inner cube appear to turn itself inside-out), then
 * perspective-project 4D→3D.
 */
export function project4Dto3D(v: Vec4, angleXW: number, angleYZ: number, d4 = 2.6): Vec3 {
  const [x, y, z, w] = v;
  const cA = Math.cos(angleXW), sA = Math.sin(angleXW);
  const cB = Math.cos(angleYZ), sB = Math.sin(angleYZ);

  const x1 = x * cA - w * sA;
  const w1 = x * sA + w * cA;
  const y1 = y * cB - z * sB;
  const z1 = y * sB + z * cB;

  const k = d4 / (d4 - w1);
  return [x1 * k, y1 * k, z1 * k];
}

/**
 * The unfolded net of the tesseract — the Dalí cross. Eight unit cubes:
 * a vertical column of four, with four arms around the second-from-top.
 * (Cube half-extent 1 ⇒ adjacent centers are 2 apart.)
 */
export const NET_CENTERS: Record<CellId, Vec3> = {
  "w+": [0, 3, 0], // outer frame — crown of the cross
  "y+": [0, 1, 0], // junction
  "w-": [0, -1, 0], // inner cube — the artifact
  "y-": [0, -3, 0],
  "x+": [2, 1, 0],
  "x-": [-2, 1, 0],
  "z+": [0, 1, 2],
  "z-": [0, 1, -2],
};

/**
 * Unfolded vertex positions for a cell: a clean axis-aligned cube at the
 * cell's net position. Ordered to correspond 1:1 with cellVertexIndices —
 * each hypercube vertex keeps its own remaining-axis signs as its cube
 * corner, so cell edges stay true cube edges throughout the morph.
 */
export function cellNetPositions(cell: CellId, spread = 1, cubeScale = 0.82): Vec3[] {
  const axis = AXIS_INDEX[cell[0] as "x" | "y" | "z" | "w"];
  const rest = [0, 1, 2, 3].filter((a) => a !== axis);
  const [cx, cy, cz] = NET_CENTERS[cell];
  return cellVertexIndices(cell).map((vi) => {
    const v = VERTS_4D[vi];
    return [
      cx * spread + v[rest[0]] * cubeScale,
      cy * spread + v[rest[1]] * cubeScale,
      cz * spread + v[rest[2]] * cubeScale,
    ];
  });
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Smooth easing for the unfold (easeInOutCubic). */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
