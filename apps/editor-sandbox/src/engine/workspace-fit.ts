/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type WorkspaceInsets = { left: number; right: number; top: number; bottom: number };
type Bounds = { x: number; y: number; width: number; height: number };

/** One fit calculation for opening a project, resizing docks, and the Fit commands. */
export function workspaceFit(
  bounds: Bounds,
  viewport: { width: number; height: number },
  insets: WorkspaceInsets,
  padding = 24,
) {
  const width = viewport.width - insets.left - insets.right - padding * 2;
  const height = viewport.height - insets.top - insets.bottom - padding * 2;
  if (width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) return null;
  const scale = Math.min(2, width / bounds.width, height / bounds.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return {
    a: scale, b: 0, c: 0, d: scale,
    e: insets.left + padding + width / 2 - (bounds.x + bounds.width / 2) * scale,
    f: insets.top + padding + height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}
