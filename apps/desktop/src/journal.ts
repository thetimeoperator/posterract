/**
 * Who wrote each revision of a project's sources.
 *
 * Two authors share one file, and the source history (see ./revisions.ts)
 * keeps *what* every version said. It does not say whose version it was — and
 * that is the half an agent needs before it writes: a caption that moved
 * because the person dragged it there is a decision to work around; one that
 * moved because the agent's own last edit put it there is not. With the actor
 * beside each revision, "what changed since I last looked" can be answered as
 * "what did *they* change", element by element (the compiler's diff does the
 * what; this does the who).
 *
 * One JSON object per line in `.posterract/journal.jsonl`, appended at the
 * places a source actually changes. It is a log, not a document: nothing reads
 * it to render anything, losing it costs attribution and nothing else, and it
 * is trimmed from the front when it grows.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const JOURNAL_FILE = ".posterract/journal.jsonl";
const MAX_JOURNAL_BYTES = 512_000;

/**
 * - `canvas`: the person, through the editor (a drag, the inspector, undo).
 * - `agent`: an agent, through the editor's tools.
 * - `external`: the file changed on disk — an agent's file tools, or an IDE.
 * - `app`: the app's own housekeeping (naming elements, lifting view state, a restore).
 */
export type JournalActor = "canvas" | "agent" | "external" | "app";

export type JournalEntry = {
  at: number;
  actor: JournalActor;
  /** Project-relative source path. */
  path: string;
  /** Revision (sha256 of the bytes) before and after; `from` is null for a file that did not exist. */
  from: string | null;
  to: string;
  note?: string;
};

export async function appendJournal(projectDir: string, entry: JournalEntry): Promise<void> {
  if (entry.from === entry.to) return;
  const path = join(projectDir, JOURNAL_FILE);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    if ((await stat(path)).size > MAX_JOURNAL_BYTES) {
      // Keep the newer half, from a line boundary.
      const text = await readFile(path, "utf8");
      const cut = text.indexOf("\n", Math.floor(text.length / 2));
      if (cut !== -1) await writeFile(path, text.slice(cut + 1));
    }
  } catch {
    // Attribution is worth having and never worth failing a write for.
  }
}

export async function readJournal(projectDir: string): Promise<JournalEntry[]> {
  let text: string;
  try {
    text = await readFile(join(projectDir, JOURNAL_FILE), "utf8");
  } catch {
    return [];
  }
  const entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Partial<JournalEntry>;
      if (typeof entry.to === "string" && typeof entry.path === "string" && typeof entry.at === "number") {
        entries.push(entry as JournalEntry);
      }
    } catch {
      // A torn line (a crash mid-append) is skipped, not fatal.
    }
  }
  return entries;
}
