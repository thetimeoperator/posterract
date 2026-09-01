/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import type { Accessor } from "solid-js";
import type {
  InspectDeclaration,
  InspectType,
  InspectValue,
} from "@posterract/composition";

export interface InspectEntry {
  file: string;
  name: string;
  type: InspectType;
  label: string;
  group: string[];
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  initial: InspectValue;
  get: Accessor<InspectValue>;
  set: (value: InspectValue) => void;
  committed: Accessor<InspectValue>;
  commit: (value: InspectValue) => void;
}

let collecting: InspectEntry[] | null = null;

/** Collects compiler-injected inspector variables during synchronous module evaluation. */
export function collectInspect<T>(fn: () => T): { result: T; entries: InspectEntry[] } {
  const entries: InspectEntry[] = [];
  const previous = collecting;
  collecting = entries;
  try {
    return { result: fn(), entries };
  } finally {
    collecting = previous;
  }
}

function prettify(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

/** Host implementation substituted for `@posterract/composition.__inspect`. */
export function __inspect(
  declaration: InspectDeclaration,
  initial: InspectValue,
): Accessor<InspectValue> {
  const [get, set] = createSignal<InspectValue>(initial);
  const [committed, setCommitted] = createSignal<InspectValue>(initial);
  const path = declaration.path ?? [];

  collecting?.push({
    file: declaration.file,
    name: declaration.name,
    type: declaration.type,
    label: path.at(-1) ?? prettify(declaration.name),
    group: path.slice(0, -1),
    ...(declaration.min === undefined ? {} : { min: declaration.min }),
    ...(declaration.max === undefined ? {} : { max: declaration.max }),
    ...(declaration.step === undefined ? {} : { step: declaration.step }),
    ...(declaration.options === undefined ? {} : { options: declaration.options }),
    initial,
    get,
    set,
    committed,
    commit(value) {
      set(value);
      setCommitted(value);
    },
  });

  return get;
}
