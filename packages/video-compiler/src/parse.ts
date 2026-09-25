/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Project } from "ts-morph";

import type { SourceFile } from "ts-morph";

/** Where a character offset falls in the text, 1-based, the way an editor counts. */
export type Locate = (position: number) => { line: number; column: number };

/** Where the parser gave up, and what it said. */
export interface ParseError {
  line: number;
  column: number;
  message: string;
}

type RawParseDiagnostic = { start?: number; messageText?: string | { messageText?: string } };

/**
 * One source file, parsed for reading — the outline, the lint, the diff.
 *
 * Whether it parsed cleanly is asked of the parser itself, which records what
 * it had to guess at on the tree it returns; building a program to ask the same
 * question is a second pass nobody needs.
 *
 * `locate` turns offsets into lines from an index of line starts built once.
 * Asking the tree for a line costs a scan of the file each time, which for a
 * reading that wants the line of every element — a real composition has a
 * couple of thousand — was most of the time the whole reading took.
 */
export function parseSourceFile(path: string, content: string): { sourceFile: SourceFile; clean: boolean; errors: ParseError[]; locate: Locate } {
  const project = new Project({ useInMemoryFileSystem: true, skipLoadingLibFiles: true });
  const sourceFile = project.createSourceFile(`/${path}`, content, { overwrite: true });
  const parseDiagnostics = (sourceFile.compilerNode as unknown as { parseDiagnostics?: RawParseDiagnostic[] }).parseDiagnostics;

  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const locate: Locate = (position) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= position) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: position - starts[low]! + 1 };
  };

  return {
    sourceFile,
    clean: !parseDiagnostics?.length,
    // The first few only: one missing brace makes the parser say the same
    // thing about everything after it, and a list of that is not more true.
    errors: (parseDiagnostics ?? []).slice(0, 5).map((diagnostic) => ({
      ...locate(diagnostic.start ?? 0),
      message: typeof diagnostic.messageText === "string"
        ? diagnostic.messageText
        : (diagnostic.messageText?.messageText ?? "The file could not be parsed"),
    })),
    locate,
  };
}
