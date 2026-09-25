/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AnyRouter } from "@trpc/server";
import { ENGINE_PROFILE, ENGINE_SOCKET_PATH, INSTANCE_PROFILE } from "./cli-socket-path";
import { resolveProjectDir } from "./project-control";
import { CLI_PROTOCOL_VERSION, SOCKET_PATH } from "./protocol";
import type { CliRequest, CliSocketReply, CliSocketRequest } from "./protocol";
import { version as cliVersion } from "../package.json";

const DEFAULT_TIMEOUT_MS = 60000;
export const GENERATE_TIMEOUT_MS = 600000;

// One command is one request/reply over the desktop-owned local socket. The
// CLI never opens a listener, which keeps it compatible with sandboxed coding
// agents that may connect to local IPC but cannot bind TCP ports.
function transport(request: CliRequest, timeoutMs: number, socketPath: string = SOCKET_PATH): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath);
    let buf = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      fn();
    };

    sock.setEncoding("utf8");
    sock.setTimeout(timeoutMs, () =>
      settle(() => reject(new Error("Timed out waiting for the Posterract desktop editor"))),
    );
    const envelope: CliSocketRequest = {
      protocolVersion: CLI_PROTOCOL_VERSION,
      request,
      timeoutMs,
      activity: {
        cliVersion,
        command: process.argv[2] || "unknown",
        projectDir: process.cwd(),
        invokedAt: Date.now(),
      },
    };
    sock.on("connect", () => sock.end(JSON.stringify(envelope)));
    sock.on("data", (chunk) => {
      buf += chunk;
    });
    sock.on("end", () => {
      let reply: CliSocketReply;
      try {
        reply = JSON.parse(buf) as CliSocketReply;
      } catch (e) {
        settle(() => reject(new Error(buf ? `Invalid desktop response: ${String(e)}` : "Desktop disconnected before replying")));
        return;
      }
      if (reply.protocolVersion !== CLI_PROTOCOL_VERSION) {
        settle(() => reject(new Error(
          `Desktop CLI protocol ${reply.protocolVersion} is incompatible with CLI protocol ${CLI_PROTOCOL_VERSION}`,
        )));
        return;
      }
      if (reply.ok) settle(() => resolve(reply.data));
      else settle(() => reject(new Error(reply.error)));
    });
    sock.on("error", (err) => settle(() => reject(err)));
  });
}

// ---------------------------------------------------------------------------
// The engine without the app
//
// Most of what the CLI does needs the renderer: a frame, an export, a measured
// layout are all made by the same browser machinery the editor draws with. That
// used to mean the app had to be open, which is the difference between a tool
// and a remote control for one. So when the app is not running and the request
// is one only a renderer can answer, the CLI starts one for itself — the app
// with no window (`--engine`), under a profile of its own — opens the project
// in it, and asks there. Whoever ran the command never has to know which
// answered.
//
// The engine outlives the command and quits by itself once nothing has asked
// anything of it for a while, so a run of commands (inspect, a frame, a render)
// pays for one start, and nothing is left running.

/** What a renderer has to answer and needs nobody at the editor for. Editing by id is not here: with the app closed the file is edited directly (see ./offline). */
const ENGINE_PATHS = new Set([
  "context", "validate", "inspect", "geometry", "check", "capture", "export", "exportProgress",
  "media.probe", "media.frame", "media.filmstrip", "media.waveform", "media.extract",
]);

const notRunning = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ECONNREFUSED";
};

/** Where requests go once the engine has had to answer one: the rest of this command's go straight there. */
let routedTo: string | undefined;

/** Whether this CLI is talking to the engine rather than to the app someone has open. */
export const usingEngine = (): boolean => routedTo === ENGINE_SOCKET_PATH;

/**
 * The command that starts the app, as `[binary, ...args]`. Installed, the CLI
 * is run by the app's own binary (see the staged `bin/posterract`), so that
 * binary is this process. From a source checkout it is plain node, and
 * `POSTERRACT_ENGINE_COMMAND` (a JSON array) says what to run instead.
 */
function engineCommand(): string[] | undefined {
  const given = process.env.POSTERRACT_ENGINE_COMMAND;
  if (given) {
    try {
      const parsed = JSON.parse(given) as unknown;
      if (Array.isArray(parsed) && parsed.length && parsed.every((part) => typeof part === "string")) return parsed as string[];
    } catch {
      // Not JSON: a path to the binary on its own.
    }
    return [given];
  }
  return process.versions.electron ? [process.execPath] : undefined;
}

async function engineAnswers(): Promise<boolean> {
  try {
    await transport({ path: "ping", input: undefined }, 2_000, ENGINE_SOCKET_PATH);
    return true;
  } catch {
    return false;
  }
}

/** Whether `path` is something the engine answers (see `ENGINE_PATHS`), and starting one is allowed. */
export const canRunOnEngine = (path: string): boolean =>
  !INSTANCE_PROFILE && process.env.POSTERRACT_NO_ENGINE !== "1" && ENGINE_PATHS.has(path);

/** One request answered by the engine, started if need be and with `projectDir` open in it: the MCP server's way in. */
export async function engineRequest(projectDir: string, request: CliRequest, timeoutMs: number): Promise<unknown> {
  await ensureEngine(projectDir);
  return transport(request, timeoutMs, ENGINE_SOCKET_PATH);
}

let engineReady: Promise<void> | undefined;
let engineProject: string | undefined;

/** Starts the engine unless one is up, waits for it, and has it open the project the command is about. */
function ensureEngine(forProject?: string): Promise<void> {
  // A CLI command is about one project; the MCP server lives on and may be asked about another.
  if (forProject !== undefined && engineProject !== undefined && forProject !== engineProject) engineReady = undefined;
  engineProject = forProject ?? engineProject;
  engineReady ??= (async () => {
    if (!(await engineAnswers())) {
      const command = engineCommand();
      if (!command) {
        throw new Error(
          "Posterract is not running, and this CLI was not started by the app, so it cannot start the engine itself. " +
            "Open Posterract, or set POSTERRACT_ENGINE_COMMAND to the app's binary.",
        );
      }
      process.stderr.write("Posterract is not open: starting the engine (no window)…\n");
      const env: NodeJS.ProcessEnv = { ...process.env, POSTERRACT_PROFILE: ENGINE_PROFILE };
      // This process runs the app's binary *as node*; the engine has to run it as the app.
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(command[0]!, [...command.slice(1), "--hidden", "--engine"], { env, detached: true, stdio: "ignore" });
      child.on("error", () => undefined);
      child.unref();

      const deadline = Date.now() + 60_000;
      while (!(await engineAnswers())) {
        if (Date.now() > deadline) throw new Error("The Posterract engine did not start within 60 seconds. `posterract doctor` checks the install.");
        await new Promise((done) => setTimeout(done, 250));
      }
    }

    // The engine has whichever project the last command left in it.
    const projectDir = forProject ?? resolveProjectDir(undefined, { here: true });
    const context = await transport({ path: "context", input: { tree: false } }, 30_000, ENGINE_SOCKET_PATH) as { projectDir?: string | null; shownRevision?: string | null };
    if (context.projectDir !== projectDir || !context.shownRevision) {
      await transport({ path: "open", input: { dir: projectDir } }, 120_000, ENGINE_SOCKET_PATH);
    }
  })();
  engineReady.catch(() => {
    engineReady = undefined;
  });
  return engineReady;
}

async function send(request: CliRequest, timeoutMs: number): Promise<unknown> {
  if (routedTo) return transport(request, timeoutMs, routedTo);
  try {
    return await transport(request, timeoutMs);
  } catch (error) {
    // A profile names one particular instance: asking for it and getting another would be wrong.
    if (!notRunning(error) || !canRunOnEngine(request.path)) throw error;
    await ensureEngine();
    routedTo = ENGINE_SOCKET_PATH;
    return transport(request, timeoutMs, ENGINE_SOCKET_PATH);
  }
}

// Terminating link: each operation uses one short-lived local socket. Long-
// running procedures pass { context: { timeoutMs } } at the call site.
const cliLink: TRPCLink<AnyRouter> =
  () =>
  ({ op }) =>
    observable((observer) => {
      const timeoutMs =
        typeof op.context.timeoutMs === "number" ? op.context.timeoutMs : DEFAULT_TIMEOUT_MS;
      send({ path: op.path, input: op.input }, timeoutMs)
        .then((data) => {
          observer.next({ result: { data } });
          observer.complete();
        })
        .catch((err) => observer.error(TRPCClientError.from(err as Error)));
      // No cancellation: the CLI process exits when the command settles.
      return () => {};
    });

// The public wire schema is defined in cli-channels.ts. Keeping this proxy
// untyped avoids pulling the full renderer program into the standalone CLI.
export const editor = createTRPCClient<AnyRouter>({ links: [cliLink] }) as any;

// Transport failures surface as TRPCClientError wrapping the socket error;
// unwrap to reach errno codes like ENOENT/ECONNREFUSED.
export function errnoCode(e: unknown): string | undefined {
  if (!(e instanceof TRPCClientError)) return undefined;
  return (e.cause as NodeJS.ErrnoException | undefined)?.code;
}

// Bridges the cold-start gap after launching the app. `ping` is answered
// by the always-mounted app router, so a single round-trip proves the app is
// fully up. The retry loop only handles the brief window before the desktop
// socket itself binds (ENOENT/ECONNREFUSED).
export async function waitForCliSocket(timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await editor.ping.query();
      return;
    } catch (e) {
      lastError = e;
      const code = errnoCode(e);
      if (code !== "ENOENT" && code !== "ECONNREFUSED") throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for the app to start");
}
