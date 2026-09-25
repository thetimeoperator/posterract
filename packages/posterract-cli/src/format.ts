/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * How the editor's answers read as text.
 *
 * The same report is printed by the CLI and returned by the MCP mirror, so it
 * is written once here. Text rather than JSON by default, because the reader
 * is an agent's context window or a person's terminal: facts first, problems
 * ranked, every problem with the element, the numbers and the fix — and a
 * stable line order, so two runs can be diffed to see what an edit changed.
 */

export type InspectProblem = {
  severity: "error" | "warning" | "note";
  code: string;
  id?: string;
  at?: number;
  message: string;
  fix?: string;
};

export type InspectElement = {
  id: string | null;
  kind: string;
  name?: string;
  start: number;
  end: number;
  text?: string;
  box?: { x: number; y: number; width: number; height: number };
  keyframes?: number;
  depth: number;
};

export type InspectResult = {
  scene: { id: string | null; name?: string; width: number; height: number; fps: number; duration: number; workarea?: [number, number] };
  elements: InspectElement[];
  markers: Array<{ time: number; name: string }>;
  problems: InspectProblem[];
  samples: number;
  ms: number;
};

export type LookResult = {
  scene: { id: string | null; name?: string; width: number; height: number } | null;
  playhead: number | null;
  selected: Array<{ id: string | null; kind: string; name?: string; text?: string; props: Record<string, unknown> }>;
  notes: Array<{ time: number; text: string }>;
  markers: Array<{ time: number; name: string }>;
};

/** A run of look-alike siblings this long is one line saying so. */
const COLLAPSE_RUNS = 6;

const time = (seconds: number): string => seconds.toFixed(2).padStart(6);
const SIGN = { error: "✗", warning: "⚠", note: "·" } as const;

function elementLine(element: InspectElement): string {
  const head = `${element.kind}${element.id ? `#${element.id}` : ""}`;
  const box = element.box ? `  ${element.box.width}×${element.box.height} at ${element.box.x},${element.box.y}` : "";
  return [
    `  ${time(element.start)}–${time(element.end)}  `,
    "  ".repeat(element.depth),
    head,
    element.name ? ` "${element.name}"` : "",
    element.text ? ` says "${element.text}"` : "",
    box,
    element.keyframes ? `  · ${element.keyframes} keyframes` : "",
  ].join("");
}

export function formatInspect(result: InspectResult): string[] {
  const { scene, elements, markers, problems } = result;
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.filter((problem) => problem.severity === "warning").length;

  const lines = [
    `${errors ? "✗" : "✓"} scene${scene.id ? `#${scene.id}` : ""}${scene.name ? ` "${scene.name}"` : ""}  ${scene.width}×${scene.height} · ${scene.fps}fps · ${scene.duration.toFixed(2)}s` +
      // Only worth a mention when it trims something: a work area that is the
      // whole scene says nothing the duration has not.
      (scene.workarea && (scene.workarea[0] > 0.001 || Math.abs(scene.workarea[1] - scene.duration) > 0.001)
        ? ` · plays ${scene.workarea[0].toFixed(2)}–${scene.workarea[1].toFixed(2)}s`
        : ""),
    `  ${elements.length} elements · ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} · ${result.samples} moments checked in ${result.ms} ms`,
    "",
    "TIMELINE   (document order: later draws on top)",
  ];

  const shape = (element: InspectElement): string => `${element.depth}:${element.kind}`;
  for (let index = 0; index < elements.length; ) {
    let end = index;
    while (end + 1 < elements.length && shape(elements[end + 1]!) === shape(elements[index]!)) end += 1;
    const run = end - index + 1;
    if (run < COLLAPSE_RUNS) {
      lines.push(elementLine(elements[index]!));
      index += 1;
      continue;
    }
    const inner = elements.slice(index + 1, end);
    lines.push(elementLine(elements[index]!));
    lines.push(
      `  ${" ".repeat(15)}${"  ".repeat(elements[index]!.depth)}… ${inner.length} more ${elements[index]!.kind} ` +
        `(${Math.min(...inner.map((item) => item.start)).toFixed(2)}–${Math.max(...inner.map((item) => item.end)).toFixed(2)}s)`,
    );
    lines.push(elementLine(elements[end]!));
    index = end + 1;
  }

  if (markers.length) {
    lines.push("", "MARKERS   (notes on the timeline; `@agent …` is addressed to you)");
    for (const marker of markers) lines.push(`  ${time(marker.time)}  ${marker.name}`);
  }

  lines.push("", "PROBLEMS");
  if (!problems.length) lines.push("  none found");
  for (const problem of problems) {
    const where = problem.at === undefined ? "" : ` @${problem.at.toFixed(2)}s`;
    lines.push(`  ${SIGN[problem.severity]} ${problem.message}${where}`);
    if (problem.fix) lines.push(`      fix: ${problem.fix}`);
  }
  return lines;
}

export function formatLook(result: LookResult): string[] {
  if (!result.scene) return ["No scene is active in the editor."];
  const { scene } = result;
  const lines = [
    `scene${scene.id ? `#${scene.id}` : ""}${scene.name ? ` "${scene.name}"` : ""}  ${scene.width}×${scene.height} · playhead ${(result.playhead ?? 0).toFixed(2)}s`,
  ];

  if (!result.selected.length) lines.push("selected: nothing");
  for (const item of result.selected) {
    const props = Object.entries(item.props).map(([name, value]) => `${name}=${value}`).join(" ");
    lines.push(`selected: ${item.kind}${item.id ? `#${item.id}` : ""}${item.name ? ` "${item.name}"` : ""}${item.text ? ` says "${item.text}"` : ""}${props ? `  ${props}` : ""}`);
  }

  if (result.notes.length) {
    lines.push("notes for you (@agent markers, nearest the playhead first):");
    for (const note of result.notes) lines.push(`  ${time(note.time)}s  ${note.text}`);
  }
  if (result.markers.length) {
    lines.push(`markers: ${result.markers.slice(0, 12).map((marker) => `${marker.time.toFixed(2)}s ${marker.name}`).join(" · ")}${result.markers.length > 12 ? " · …" : ""}`);
  }
  return lines;
}
