/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { writeFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";

const SECRET_KEY = /(authorization|cookie|password|secret|token|api[-_]?key|refresh|session)/i;
const INLINE_SECRET = /(bearer\s+|sk-[a-z0-9_-]{8,}|eyJ[a-zA-Z0-9_-]{12,})[^\s"']*/gi;

function redactText(value: string): string {
  return value.replace(INLINE_SECRET, "[REDACTED]");
}

export function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? "[REDACTED]" : sanitize(nested),
    ]),
  );
}

export function createDiagnosticZip(output: string, files: Record<string, unknown>): void {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, value]) => [
      name,
      strToU8(typeof value === "string" ? redactText(value) : JSON.stringify(sanitize(value), null, 2) + "\n"),
    ]),
  );
  writeFileSync(output, zipSync(entries, { level: 6 }));
}
