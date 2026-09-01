/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { randomBytes, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import {
  CLI_PROTOCOL_VERSION,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_RUNTIME,
  type CliSocketRequest,
  type LocalControlRequest,
  type LocalControlResponse,
  type LocalControlSession,
} from "@posterract/cli/protocol";
import { relayCliRequest } from "./cli-server.ts";

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_TIMEOUT_MS = 600_000;
const SESSION_LIFETIME_MS = 24 * 60 * 60_000;
const SESSION_REFRESH_MS = 60 * 60_000;

type ActiveMailbox = {
  projectId: string;
  projectDir: string;
  runtimeDir: string;
  requestsDir: string;
  responsesDir: string;
  instanceId: string;
  capability: string;
  watcher: FSWatcher;
  refreshTimer: ReturnType<typeof setInterval>;
  processing: Set<string>;
};

let active: ActiveMailbox | null = null;
let getWindow: (() => BrowserWindow | null) | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function publishSession(mailbox: ActiveMailbox): Promise<void> {
  const now = Date.now();
  const session: LocalControlSession = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    cliProtocolVersion: CLI_PROTOCOL_VERSION,
    desktopVersion: app.getVersion(),
    projectId: mailbox.projectId,
    projectDir: mailbox.projectDir,
    instanceId: mailbox.instanceId,
    capability: mailbox.capability,
    createdAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
    rendererAvailable: Boolean(getWindow?.() && !getWindow?.()?.isDestroyed()),
  };
  await writeAtomic(join(mailbox.runtimeDir, LOCAL_CONTROL_RUNTIME.session), session);
}

function validRequestName(name: string): boolean {
  return /^[0-9a-f-]{36}\.json$/i.test(name);
}

async function processRequest(mailbox: ActiveMailbox, name: string): Promise<void> {
  if (!validRequestName(name) || mailbox.processing.has(name)) return;
  mailbox.processing.add(name);
  const requestPath = join(mailbox.requestsDir, name);
  const responsePath = join(mailbox.responsesDir, name);
  let request: LocalControlRequest | null = null;
  try {
    const bytes = await readFile(requestPath);
    if (bytes.byteLength > MAX_REQUEST_BYTES) throw new Error("Local-control request is too large");
    request = JSON.parse(bytes.toString("utf8")) as LocalControlRequest;
    if (
      request.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION ||
      request.id !== name.slice(0, -5) ||
      request.instanceId !== mailbox.instanceId ||
      request.capability !== mailbox.capability ||
      resolve(request.projectDir) !== resolve(mailbox.projectDir)
    ) {
      throw new Error("The local-control request is not authorized for this project session");
    }
    if (!request.request || typeof request.request.path !== "string" || !request.request.path) {
      throw new Error("Invalid local-control request");
    }
    const now = Date.now();
    if (!Number.isFinite(request.deadline) || request.deadline <= now) {
      throw new Error("The local-control request expired before Desktop received it");
    }
    const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, request.deadline - now));
    if (!getWindow) throw new Error("Posterract Desktop local control is unavailable");
    const envelope: CliSocketRequest = {
      protocolVersion: CLI_PROTOCOL_VERSION,
      request: request.request,
      timeoutMs,
      activity: request.activity,
    };
    const reply = await relayCliRequest(envelope, getWindow);
    const response: LocalControlResponse = reply.ok
      ? {
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          id: request.id,
          ok: true,
          data: reply.data,
          completedAt: Date.now(),
        }
      : {
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          id: request.id,
          ok: false,
          error: reply.error,
          completedAt: Date.now(),
        };
    await writeAtomic(responsePath, response);
  } catch (error) {
    const id = request?.id ?? name.slice(0, -5);
    const response: LocalControlResponse = {
      protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
      id,
      ok: false,
      error: errorMessage(error),
      completedAt: Date.now(),
    };
    await writeAtomic(responsePath, response).catch(() => undefined);
  } finally {
    mailbox.processing.delete(name);
    await rm(requestPath, { force: true }).catch(() => undefined);
  }
}

async function scan(mailbox: ActiveMailbox): Promise<void> {
  const names = await readdir(mailbox.requestsDir).catch(() => [] as string[]);
  await Promise.all(names.filter(validRequestName).map((name) => processRequest(mailbox, name)));
}

async function closeActive(): Promise<void> {
  if (!active) return;
  const previous = active;
  active = null;
  previous.watcher.close();
  clearInterval(previous.refreshTimer);
  await rm(previous.runtimeDir, { recursive: true, force: true }).catch(() => undefined);
}

export function initializeProjectControlMailbox(windowProvider: () => BrowserWindow | null): void {
  getWindow = windowProvider;
}

export async function setProjectControlMailbox(project: { id: string; dir: string }): Promise<void> {
  const projectDir = resolve(project.dir);
  if (active?.projectDir === projectDir) {
    await publishSession(active);
    return;
  }
  await closeActive();

  const runtimeDir = join(projectDir, LOCAL_CONTROL_RUNTIME.dir);
  const requestsDir = join(runtimeDir, LOCAL_CONTROL_RUNTIME.requests);
  const responsesDir = join(runtimeDir, LOCAL_CONTROL_RUNTIME.responses);
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(requestsDir, { recursive: true, mode: 0o700 });
  await mkdir(responsesDir, { recursive: true, mode: 0o700 });
  await mkdir(join(runtimeDir, LOCAL_CONTROL_RUNTIME.captures), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(runtimeDir, 0o700);

  const mailbox = {
    projectId: project.id,
    projectDir,
    runtimeDir,
    requestsDir,
    responsesDir,
    instanceId: randomUUID(),
    capability: randomBytes(32).toString("hex"),
    watcher: null as unknown as FSWatcher,
    refreshTimer: null as unknown as ReturnType<typeof setInterval>,
    processing: new Set<string>(),
  } satisfies ActiveMailbox;
  mailbox.watcher = watch(requestsDir, (_event, name) => {
    if (typeof name === "string") void processRequest(mailbox, name);
    else void scan(mailbox);
  });
  mailbox.refreshTimer = setInterval(() => void publishSession(mailbox), SESSION_REFRESH_MS);
  active = mailbox;
  await publishSession(mailbox);
  await scan(mailbox);
}

export async function stopProjectControlMailbox(): Promise<void> {
  getWindow = null;
  await closeActive();
}
