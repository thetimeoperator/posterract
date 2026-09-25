/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What is wrong with the video since the agent last heard, said without being
 * asked — for every agent, not one.
 *
 * An agent edits the file with its own tools and cannot see the canvas, so
 * somebody has to tell it that the caption it just moved now runs off the
 * frame. The first version of that was a hook in one agent's own hook system
 * (Claude Code's PostToolUse), which is exactly as portable as it sounds: every
 * other agent edited blind unless it remembered to ask. Agents' hook systems
 * differ, change, and mostly cannot feed text back to the model at all.
 *
 * What every agent does have is this: it talks to Posterract — through the MCP
 * server the app connects it with, or the CLI. So the check lives here, on
 * Posterract's side of that conversation. Whenever the sources have changed
 * since the last look, the next thing the agent asks for — anything at all —
 * comes back with what is newly wrong attached. Nothing to install per agent,
 * nothing to keep up with, and an agent nobody has heard of yet is covered the
 * day it connects.
 *
 * Each finding is said once. An agent that has been told a caption is cut off
 * and chose to leave it does not need telling after every edit; a finding that
 * goes away and comes back is said again.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { InspectResult } from "./format";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const SKIPPED = new Set(["node_modules", ".git", ".posterract", "exports", "assets"]);

/** Changes whenever a composition source does. Stats only: this runs on every call. */
export function sourcesFingerprint(projectDir: string): string {
  const parts: string[] = [];
  const visit = (folder: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIPPED.has(entry.name)) continue;
      const absolute = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth < 6) visit(absolute, depth + 1);
      } else if (SOURCE_FILE.test(entry.name)) {
        try {
          const details = statSync(absolute);
          parts.push(`${relative(projectDir, absolute).split(sep).join("/")}:${details.size}:${details.mtimeMs}`);
        } catch {
          // Gone between the listing and the stat: the next look sees that.
        }
      }
    }
  };
  visit(projectDir, 0);
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}

export interface FeedbackState {
  /** The sources as they were when each half was last checked. */
  linted?: string;
  inspected?: string;
  /** Findings the agent has been given and that are still true. */
  told: string[];
}

export interface FeedbackStore {
  read(): FeedbackState;
  write(state: FeedbackState): void;
}

/** For a process that lives as long as the agent's session does (the MCP server). */
export function memoryStore(initial: FeedbackState = { told: [] }): FeedbackStore {
  let state = initial;
  return { read: () => state, write: (next) => { state = next; } };
}

/** For the CLI, where each command is a process of its own: kept beside the project's other caches. */
export function fileStore(projectDir: string): FeedbackStore {
  const path = join(projectDir, ".posterract", "cache", "edit-feedback.json");
  return {
    read() {
      try {
        const value = JSON.parse(readFileSync(path, "utf8")) as Partial<FeedbackState>;
        return { ...(typeof value.linted === "string" ? { linted: value.linted } : {}), ...(typeof value.inspected === "string" ? { inspected: value.inspected } : {}), told: Array.isArray(value.told) ? value.told.filter((entry) => typeof entry === "string") : [] };
      } catch {
        return { told: [] };
      }
    },
    write(state) {
      try {
        mkdirSync(join(projectDir, ".posterract", "cache"), { recursive: true });
        writeFileSync(path, JSON.stringify(state));
      } catch {
        // Feedback that cannot remember itself repeats itself; nothing worse.
      }
    },
  };
}

export interface EditFeedback {
  /** The sources are as the agent has seen them: nothing that is wrong now is news. Called once, when a session starts. */
  baseline(): void;
  /** What is newly wrong since the agent last heard, as text to attach to whatever it asked for; undefined when nothing is. */
  since(): Promise<string | undefined>;
  /**
   * The agent has just been given these by a check of its own asking (`lint`,
   * `inspect`), which also means that half of the sources is as checked as it
   * gets: nothing is run again to say the same thing twice.
   */
  heard(findings: string[], half: "lint" | "inspect"): void;
}

/**
 * What makes a finding the same finding: what it says, not where in the file it
 * was when it was said. A lint finding leads with `file:line:col`, and every
 * edit above it moves the line; a fix is advice about the finding, not part of
 * it. Both are left out, so a problem the agent was told about is not told
 * again because the file grew, or because it was first heard from `inspect`
 * and is now met here.
 */
const keyOf = (finding: string): string => finding.split("\n")[0]!.replace(/^\S+?:\d+:\d+\s+/, "").trim();

const isFinding = (line: string): boolean => /^[✗⚠]/.test(keyOf(line));

const problemLines = (result: InspectResult): string[] =>
  result.problems
    .filter((problem) => problem.severity !== "note")
    .map((problem) => {
      const where = problem.at === undefined ? "" : ` @${problem.at.toFixed(2)}s`;
      return `${problem.severity === "error" ? "✗" : "⚠"} ${problem.message}${where}${problem.fix ? `\n    fix: ${problem.fix}` : ""}`;
    });

export function createEditFeedback(options: {
  projectDir: () => string;
  store: FeedbackStore;
  /** Props and values the editor does not understand, one finding per line. Reads the files; always available. */
  lint: (projectDir: string) => string[];
  /**
   * Layout problems of every video in the project, from whoever can render it.
   * Rejects (or never settles) when nobody can right now; the lint half is
   * reported regardless, and this half is tried again on the next call.
   */
  inspect?: (projectDir: string) => Promise<InspectResult[]>;
  /** How long the layout half may take before this call goes back without it. */
  budgetMs?: number;
}): EditFeedback {
  const { store } = options;

  return {
    baseline() {
      let projectDir: string;
      try {
        projectDir = options.projectDir();
      } catch {
        return;
      }
      const now = sourcesFingerprint(projectDir);
      store.write({ linted: now, inspected: now, told: store.read().told });
    },

    heard(findings, half) {
      let now: string | undefined;
      try {
        now = sourcesFingerprint(options.projectDir());
      } catch {
        // No project to fingerprint: only the findings are remembered.
      }
      const state = store.read();
      store.write({
        ...state,
        ...(now && half === "lint" ? { linted: now } : {}),
        ...(now && half === "inspect" ? { inspected: now } : {}),
        told: [...new Set([...state.told, ...findings.filter(isFinding).map(keyOf)])],
      });
    },

    async since() {
      let projectDir: string;
      try {
        projectDir = options.projectDir();
      } catch {
        return undefined;
      }
      if (!existsSync(projectDir)) return undefined;

      const state = store.read();
      const now = sourcesFingerprint(projectDir);
      // Never looked before (a CLI's first run in this project): what is there is where it starts from.
      if (state.linted === undefined && state.inspected === undefined) {
        store.write({ linted: now, inspected: now, told: state.told });
        return undefined;
      }
      if (state.linted === now && state.inspected === now) return undefined;

      const found: string[] = [];
      let linted = state.linted;
      let inspected = state.inspected;

      if (linted !== now) {
        try {
          found.push(...options.lint(projectDir));
          linted = now;
        } catch {
          // A project that cannot be read has bigger news than this.
        }
      }

      if (inspected !== now && options.inspect) {
        const budget = new Promise<"late">((done) => setTimeout(() => done("late"), options.budgetMs ?? 6_000).unref?.());
        const result = await Promise.race([options.inspect(projectDir).catch(() => "late" as const), budget]);
        if (result !== "late") {
          for (const scene of result) found.push(...problemLines(scene));
          inspected = now;
        }
      } else if (!options.inspect) {
        inspected = now;
      }

      // Said once. What is no longer true is forgotten, so that it is news if it comes back —
      // but only among what this round could have found again.
      const keys = new Set(found.map(keyOf));
      const fresh = [...new Map(found.map((finding) => [keyOf(finding), finding])).values()].filter((finding) => !state.told.includes(keyOf(finding)));
      const checkedAll = linted === now && inspected === now;
      const stillTrue = checkedAll ? state.told.filter((key) => keys.has(key)) : state.told;
      store.write({ ...(linted ? { linted } : {}), ...(inspected ? { inspected } : {}), told: [...new Set([...stillTrue, ...fresh.map(keyOf)])] });

      if (!fresh.length) return undefined;
      const errors = fresh.filter((finding) => keyOf(finding).startsWith("✗")).length;
      return [
        `Posterract checked the video, because its source changed since your last call — ${fresh.length} new ${fresh.length === 1 ? "problem" : "problems"}${errors ? ` (${errors} ✗)` : ""}:`,
        "",
        ...fresh,
        "",
        "Fix every ✗ before moving on; judge every ⚠. Each is said once: `posterract inspect` lists all that are open.",
      ].join("\n");
    },
  };
}
