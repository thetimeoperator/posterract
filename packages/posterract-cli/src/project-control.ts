/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import {
  CLI_PROTOCOL_VERSION,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_RUNTIME,
  type CliActivityMetadata,
  type CliRequest,
  type LocalControlRequest,
  type LocalControlResponse,
  type LocalControlSession,
} from "./protocol";

const POLL_MS = 35;
const ACTIVE_PROJECT_POINTER_VERSION = 1;
/**
 * Desktop rewrites session.json every ~15s while it is alive. Three missed
 * beats means the process is gone (crash, force quit) even though the session
 * file itself survives for a day; treat that as unreachable up front instead
 * of writing a request nobody will ever answer.
 */
const HEARTBEAT_STALE_MS = 45_000;

type ActiveProjectPointer = {
  version: typeof ACTIVE_PROJECT_POINTER_VERSION;
  projectDir: string;
  updatedAt: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function looksLikeProject(dir: string): boolean {
  try {
    const pkg = readJson<{ posterract?: unknown }>(join(dir, "package.json"));
    return pkg.posterract !== undefined;
  } catch {
    return false;
  }
}

/**
 * One non-secret pointer shared by Desktop and the installed MCP plugin.
 * Project-local capability files still authenticate every canvas request.
 */
export function activeProjectPointerPath(): string {
  const runtime = process.env.POSTERRACT_RUNTIME_DIR;
  return runtime
    ? join(resolve(runtime), "active-project.json")
    : join(homedir(), ".posterract", "runtime", "active-project.json");
}

function readActiveProjectPointer(): string | null {
  try {
    const value = readJson<Partial<ActiveProjectPointer>>(activeProjectPointerPath());
    if (
      value.version !== ACTIVE_PROJECT_POINTER_VERSION ||
      typeof value.projectDir !== "string" ||
      !looksLikeProject(resolve(value.projectDir))
    ) {
      return null;
    }
    return resolve(value.projectDir);
  } catch {
    return null;
  }
}

export function writeActiveProjectPointer(projectDir: string): void {
  const normalized = resolve(projectDir);
  if (!looksLikeProject(normalized)) throw new Error("Cannot activate a folder that is not a Posterract project.");
  const target = activeProjectPointerPath();
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: ACTIVE_PROJECT_POINTER_VERSION, projectDir: normalized, updatedAt: Date.now() })}\n`,
    { mode: 0o600 },
  );
  renameSync(temporary, target);
}

export function clearActiveProjectPointer(projectDir?: string): void {
  if (projectDir) {
    const current = readActiveProjectPointer();
    if (!current || current !== resolve(projectDir)) return;
  }
  rmSync(activeProjectPointerPath(), { force: true });
}

/** Resolve a Posterract project without depending on client-specific roots. */
export function resolveProjectDir(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.POSTERRACT_PROJECT_DIR,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.VSCODE_CWD,
    readActiveProjectPointer(),
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    let current = resolve(candidate);
    const root = parse(current).root;
    while (true) {
      if (looksLikeProject(current)) return current;
      if (current === root) break;
      current = dirname(current);
    }
  }
  throw new Error("No Posterract project found. Open a project in Posterract Desktop and launch the agent from that folder.");
}

export function localControlPaths(projectDir: string) {
  const runtime = join(projectDir, LOCAL_CONTROL_RUNTIME.dir);
  return {
    runtime,
    session: join(runtime, LOCAL_CONTROL_RUNTIME.session),
    requests: join(runtime, LOCAL_CONTROL_RUNTIME.requests),
    responses: join(runtime, LOCAL_CONTROL_RUNTIME.responses),
    captures: join(runtime, LOCAL_CONTROL_RUNTIME.captures),
  };
}

export function readLocalControlSession(projectDir: string): LocalControlSession {
  const { session } = localControlPaths(projectDir);
  if (!existsSync(session)) {
    throw new Error("Posterract Desktop is not exposing this project. Open the project in Desktop and retry.");
  }
  const value = readJson<LocalControlSession>(session);
  if (value.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION) {
    throw new Error(
      `Desktop local-control protocol ${value.protocolVersion} is incompatible with ${LOCAL_CONTROL_PROTOCOL_VERSION}. Update Posterract Desktop.`,
    );
  }
  if (value.cliProtocolVersion !== CLI_PROTOCOL_VERSION) {
    throw new Error(
      `Desktop CLI protocol ${value.cliProtocolVersion} is incompatible with ${CLI_PROTOCOL_VERSION}. Update the Posterract tools.`,
    );
  }
  if (resolve(value.projectDir) !== resolve(projectDir)) {
    throw new Error("The local-control session belongs to a different project.");
  }
  if (value.expiresAt <= Date.now()) {
    throw new Error("The Posterract project session expired. Reopen the project in Desktop.");
  }
  if (typeof value.heartbeatAt === "number" && Date.now() - value.heartbeatAt > HEARTBEAT_STALE_MS) {
    throw new Error(
      "Posterract Desktop is not responding: its project session heartbeat is stale. Start Posterract Desktop and open this project, then retry.",
    );
  }
  if (!value.rendererAvailable) {
    throw new Error("The Posterract canvas renderer is not available yet.");
  }
  return value;
}

export async function requestProjectControl(
  projectDir: string,
  request: CliRequest,
  timeoutMs: number,
  activity?: CliActivityMetadata,
): Promise<unknown> {
  const paths = localControlPaths(projectDir);
  const session = readLocalControlSession(projectDir);
  mkdirSync(paths.requests, { recursive: true, mode: 0o700 });
  mkdirSync(paths.responses, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const requestPath = join(paths.requests, `${id}.json`);
  const temporary = `${requestPath}.${process.pid}.tmp`;
  const responsePath = join(paths.responses, `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  const envelope: LocalControlRequest = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    id,
    instanceId: session.instanceId,
    capability: session.capability,
    projectDir,
    deadline,
    request,
    activity,
  };
  writeFileSync(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
  renameSync(temporary, requestPath);

  try {
    while (Date.now() <= deadline) {
      // Read directly instead of exists-then-read: the response can be
      // created or removed between the two calls, and a vanished file must
      // mean "keep polling", never a crashed request.
      let raw: string | null = null;
      try {
        raw = readFileSync(responsePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (raw !== null) {
        const response = JSON.parse(raw) as LocalControlResponse;
        if (response.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION || response.id !== id) {
          throw new Error("Posterract Desktop returned an invalid local-control response.");
        }
        if (response.ok) return response.data;
        throw new Error(response.error);
      }
      await sleep(POLL_MS);
    }
    throw new Error(`Timed out waiting for Posterract Desktop to answer ${request.path}.`);
  } finally {
    rmSync(requestPath, { force: true });
    rmSync(responsePath, { force: true });
  }
}
