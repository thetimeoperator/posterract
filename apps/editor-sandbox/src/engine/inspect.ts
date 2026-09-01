/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import type { Accessor } from "solid-js";
import type { InspectEntry } from "@posterract/video-reconciler";
import type { World } from "koota";

interface Registry {
  entries: Accessor<InspectEntry[]>;
  setEntries: (entries: InspectEntry[]) => void;
}

const registries = new WeakMap<World, Registry>();

function registry(world: World): Registry {
  let current = registries.get(world);
  if (!current) {
    const [entries, setEntries] = createSignal<InspectEntry[]>([]);
    current = { entries, setEntries: (next) => setEntries(next) };
    registries.set(world, current);
  }
  return current;
}

export function setInspectEntries(world: World, entries: InspectEntry[]): void {
  registry(world).setEntries(entries);
}

export function useInspectEntries(world: World): Accessor<InspectEntry[]> {
  return registry(world).entries;
}

export function getInspectEntries(world: World): InspectEntry[] {
  return registry(world).entries();
}

export function findInspectEntry(world: World, file: string, name: string): InspectEntry | undefined {
  return registry(world).entries().find((entry) => entry.file === file && entry.name === name);
}
