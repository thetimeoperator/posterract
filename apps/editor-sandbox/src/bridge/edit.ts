/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { InspectValue, PropValue, SerializedAssetRef } from "@posterract/composition";

export type EditValue = PropValue | SerializedAssetRef;

export type SourceEdit =
  | { kind: "set"; source: string; props: Record<string, EditValue>; text?: string }
  | { kind: "insert"; source: string; parent: string; tag: string; props: Record<string, EditValue>; before?: string; text?: string }
  | { kind: "move"; source: string; parent: string; before?: string }
  | { kind: "remove"; source: string }
  | { kind: "variable"; file: string; name: string; value: InspectValue }
  | {
      kind: "unroll";
      source: string;
      iterations: Array<Record<string, { props: Record<string, EditValue>; text?: string; pending?: string }>>;
    };

export interface WriteResult {
  skipped: string[];
  ids?: Record<string, string>;
  unrolled?: string[];
  error?: string;
}
