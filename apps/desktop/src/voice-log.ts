/**
 * What was said to the editor, and what it made of it.
 *
 * One JSON object per line in `.posterract/voice-log.jsonl`: the words, how
 * they were read (the intents, the slots, how sure), whether it ran, and
 * whether it was taken back straight away. It is how the reading gets better
 * after launch — `scripts/voice-log-to-corpus.mjs` turns the commands that
 * were undone or corrected into new test sentences.
 *
 * **Words only.** Never audio, never a key, never anything about the person.
 * It stays in the project folder on this machine, and losing it costs nothing
 * but the next round of test sentences.
 */
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const VOICE_LOG_FILE = ".posterract/voice-log.jsonl";
const MAX_VOICE_LOG_BYTES = 512_000;

export type VoiceLogEntry = {
  at: number;
  /** What was typed or said. */
  said: string;
  /** How it arrived. */
  how: "typed" | "spoken";
  /** The intents it was read as, with their slots. */
  steps?: Array<{ intent: string; slots?: Record<string, unknown>; targets?: string[] }>;
  /** apply · confirm · choose · note · nothing. */
  lane?: string;
  confidence?: number;
  /** Whether it actually ran. */
  ran?: boolean;
  /** What the bar said afterwards, or why it could not. */
  said_back?: string;
  /** Set when the person took it back within a few seconds. */
  undone?: boolean;
  /** A chip the person corrected, and to what. */
  corrected?: { key: string; to: string };
  /** How long the reading took, in ms. */
  ms?: number;
};

/** Appends one line; never throws, and never fails a command. */
export async function appendVoiceLog(projectDir: string, entry: VoiceLogEntry): Promise<void> {
  if (!projectDir || typeof entry?.said !== "string") return;
  const path = join(projectDir, VOICE_LOG_FILE);
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`);
    if ((await stat(path)).size > MAX_VOICE_LOG_BYTES) {
      const text = await readFile(path, "utf8");
      const cut = text.indexOf("\n", Math.floor(text.length / 2));
      if (cut !== -1) await writeFile(path, text.slice(cut + 1));
    }
  } catch {
    // A log worth having is never worth failing a command for.
  }
}

/** Every line of the log, oldest first; an unreadable line is skipped. */
export async function readVoiceLog(projectDir: string): Promise<VoiceLogEntry[]> {
  try {
    const text = await readFile(join(projectDir, VOICE_LOG_FILE), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as VoiceLogEntry];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
