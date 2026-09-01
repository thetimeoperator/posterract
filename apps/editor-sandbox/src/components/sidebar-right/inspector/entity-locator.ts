/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Source } from "@posterract/video-runtime";

import type { Entity } from "koota";

/**
 * Runtime entities are replaced when an outside source edit remounts a
 * composition. Floating inspectors keep this source-backed locator instead
 * of the disposable Entity object so the same authored child stays open.
 */
export type EntityLocator = {
  source?: string;
  index: number;
};

export function locateEntity(entity: Entity, siblings: Entity[]): EntityLocator {
  return {
    source: entity.get(Source)?.value,
    index: siblings.indexOf(entity),
  };
}

export function resolveEntity(locator: EntityLocator | undefined, siblings: Entity[]): Entity | undefined {
  if (!locator) return undefined;
  if (locator.source) {
    return siblings.find((entity) => entity.get(Source)?.value === locator.source);
  }
  return siblings[locator.index];
}

export function renameLocator(
  locator: EntityLocator | undefined,
  ids: Record<string, string>,
): EntityLocator | undefined {
  if (!locator?.source) return locator;
  const source = ids[locator.source];
  return source ? { ...locator, source } : locator;
}
