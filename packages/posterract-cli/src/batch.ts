/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * One video per row of a spreadsheet.
 *
 * A Posterract project is code with named, documented inspector variables, so
 * a data file is already a list of takes: each row sets those variables and
 * exports. This is the thing the format makes almost free and that a timeline
 * editor cannot do at all.
 *
 * Rendering is sequential on purpose — the encoder owns the GPU, and two at
 * once is slower than one after another as well as far harder to reason about
 * when one fails.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

export type BatchRow = Record<string, string>;

/**
 * A minimal RFC 4180 reader: quoted fields, embedded commas, doubled quotes,
 * and CRLF. Deliberately not a dependency — the whole grammar is ten lines and
 * a CSV parser is not worth a supply-chain entry.
 */
export function parseCsv(text: string): BatchRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // A lone \r, or the \r of a \r\n, ends the row once.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
  if (!header) return [];
  return body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), (cells[index] ?? "").trim()])),
  );
}

export function readBatchRows(path: string): BatchRow[] {
  const text = readFileSync(resolve(path), "utf8").replace(/^﻿/, "");
  if (extname(path).toLowerCase() === ".json") {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) throw new Error("A JSON batch file must be an array of row objects");
    return value.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error("Every row of a JSON batch file must be an object");
      }
      return Object.fromEntries(
        Object.entries(row as Record<string, unknown>).map(([key, cell]) => [key, String(cell ?? "")]),
      );
    });
  }
  return parseCsv(text);
}

/**
 * The file one row writes to.
 *
 * `--output` is a template: `{name}` is a column, `{n}` the row number. A
 * template with no placeholder would have every row overwrite the last, so
 * the row number is appended rather than letting that happen silently.
 */
export function outputPathFor(template: string, row: BatchRow, index: number): string {
  const used = { value: false };
  let filled = template.replace(/\{([A-Za-z0-9_ -]+)\}/g, (_match, key: string) => {
    used.value = true;
    if (key === "n") return String(index + 1);
    const cell = row[key];
    if (cell === undefined) throw new Error(`The output template names "${key}", which is not a column`);
    // A cell becomes part of a filename, and a spreadsheet holds whatever
    // someone typed. Keep only what is safe in a name, and never let the
    // result start with a dot — no separators means it cannot leave the
    // output directory, and no leading dot means it cannot hide once there.
    const safe = cell
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .replace(/^[.\s]+/, "")
      .trim();
    return safe || String(index + 1);
  });
  if (!used.value) {
    const extension = extname(filled) || ".mp4";
    filled = join(dirname(filled), `${basename(filled, extension)}-${index + 1}${extension}`);
  }
  return resolve(filled);
}
