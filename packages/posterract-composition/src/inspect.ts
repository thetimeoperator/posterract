/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Accessor } from "solid-js";

/** JSDoc tag used to expose a top-level composition constant in the inspector. */
export const INSPECT_TAG = "inspect";

/** Inspector controls supported by the Posterract composition SDK. */
export const INSPECT_TYPES = ["number", "color", "text", "font", "boolean", "select"] as const;

export type InspectType = (typeof INSPECT_TYPES)[number];
export type InspectValue = string | number | boolean;

export interface InspectDeclaration {
  /** Project-relative source file containing the declaration. */
  file: string;
  /** Top-level const name. Together with file this is the stable identity. */
  name: string;
  type: InspectType;
  /** Presentation path. The final segment is the label; preceding segments are groups. */
  path?: string[];
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

function hostOnly(name: string): never {
  throw new Error(`${name} is supplied by the Posterract editor while a project is mounted.`);
}

/**
 * Compiler-injected host hook. Project authors use `@inspect` annotations;
 * they never call this function directly.
 */
export function __inspect(
  declaration: InspectDeclaration,
  initial: InspectValue,
): Accessor<InspectValue> {
  void declaration;
  void initial;
  return hostOnly("__inspect");
}
