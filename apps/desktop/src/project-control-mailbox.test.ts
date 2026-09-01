/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Exercises the project-control mailbox against a real filesystem and a fake
// renderer (electron is aliased to ./testing/electron-stub.ts at build time):
//
//   esbuild src/project-control-mailbox.test.ts --bundle --platform=node \
//     --format=esm --alias:electron=./src/testing/electron-stub.ts \
//     --outfile=.tmp/project-control-mailbox.test.mjs && \
//   node --test .tmp/project-control-mailbox.test.mjs
//
// The focus is the double-processing race: deleting a consumed request file
// re-fires the requests/ watcher with the same filename, and that echo used
// to be answered with a spurious ENOENT error response that overwrote or
// duplicated the real one.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BrowserWindow } from "electron";
import { emitIpcMainEvent } from "./testing/electron-stub.ts";
import {
  CLI_PROTOCOL_VERSION,
  CLI_WIRE,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  LOCAL_CONTROL_RUNTIME,
  type CliRendererRequest,
  type LocalControlRequest,
  type LocalControlResponse,
  type LocalControlSession,
} from "@posterract/cli/protocol";
import {
  initializeProjectControlMailbox,
  setProjectControlMailbox,
  stopProjectControlMailbox,
} from "./project-control-mailbox.ts";

const REPLY_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A renderer that answers every relayed CLI request `ok` after a delay. */
function fakeWindow(): BrowserWindow {
  const webContents = {
    id: 7,
    isCrashed: () => false,
    isLoading: () => false,
    send: (channel: string, payload: unknown) => {
      if (channel !== CLI_WIRE.REQUEST) return;
      const request = payload as CliRendererRequest;
      setTimeout(() => {
        emitIpcMainEvent(CLI_WIRE.RESPONSE, { sender: { id: webContents.id } }, {
          protocolVersion: CLI_PROTOCOL_VERSION,
          id: request.id,
          token: request.token,
          reply: { ok: true, data: { answered: request.request.path } },
        });
      }, REPLY_DELAY_MS);
    },
  };
  return { isDestroyed: () => false, webContents } as unknown as BrowserWindow;
}

async function makeProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "posterract-mailbox-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ posterract: { schemaVersion: 1 } }));
  return dir;
}

async function readSession(dir: string): Promise<LocalControlSession> {
  const path = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.session);
  return JSON.parse(await readFile(path, "utf8")) as LocalControlSession;
}

/** Writes a request the way the CLI does: temp sibling, then atomic rename. */
async function postRequest(dir: string, session: LocalControlSession, deadline: number): Promise<string> {
  const id = randomUUID();
  const requestsDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.requests);
  const requestPath = join(requestsDir, `${id}.json`);
  const envelope: LocalControlRequest = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    id,
    instanceId: session.instanceId,
    capability: session.capability,
    projectDir: dir,
    deadline,
    request: { path: "canvas.state", input: undefined },
  };
  const temporary = `${requestPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(envelope)}\n`);
  await rename(temporary, requestPath);
  return id;
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await sleep(20);
  }
  throw new Error("Timed out waiting for the mailbox");
}

test("a consumed request yields exactly one response, and the deletion echo never rewrites it", async () => {
  const dir = await makeProject();
  try {
    initializeProjectControlMailbox(fakeWindow);
    await setProjectControlMailbox({ id: "test-project", dir });
    const session = await readSession(dir);
    assert.equal(typeof session.heartbeatAt, "number", "session.json publishes a heartbeat");
    assert.ok(Math.abs(Date.now() - (session.heartbeatAt ?? 0)) < 5_000, "the heartbeat is fresh");

    const responsesDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.responses);
    const requestsDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.requests);
    const id = await postRequest(dir, session, Date.now() + 30_000);

    const response = await waitFor(async () => {
      try {
        return JSON.parse(await readFile(join(responsesDir, `${id}.json`), "utf8")) as LocalControlResponse;
      } catch {
        return null;
      }
    });
    assert.equal(response.ok, true, "the real reply reaches the response file");
    assert.equal(response.id, id);

    // Give the fs.watch echo of the request deletion every chance to land;
    // before the guard fix it re-processed the vanished request and wrote an
    // `ok:false` ENOENT response over (or next to) the real one.
    await sleep(600);
    const settled = JSON.parse(await readFile(join(responsesDir, `${id}.json`), "utf8")) as LocalControlResponse;
    assert.equal(settled.ok, true, "the deletion echo must not replace the response with an error");
    assert.deepEqual(await readdir(responsesDir), [`${id}.json`], "exactly one response file exists");
    assert.deepEqual(await readdir(requestsDir), [], "the consumed request file is gone");
  } finally {
    await stopProjectControlMailbox();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an expired request is consumed without writing an unconsumable response", async () => {
  const dir = await makeProject();
  try {
    initializeProjectControlMailbox(fakeWindow);
    await setProjectControlMailbox({ id: "test-project", dir });
    const session = await readSession(dir);

    const responsesDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.responses);
    const requestsDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.requests);
    await postRequest(dir, session, Date.now() - 1_000);

    await waitFor(async () => ((await readdir(requestsDir)).length === 0 ? true : null));
    await sleep(300);
    assert.deepEqual(await readdir(responsesDir), [], "no response is written after the caller's deadline");
  } finally {
    await stopProjectControlMailbox();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a request already consumed by someone else is ignored, not answered with ENOENT", async () => {
  const dir = await makeProject();
  try {
    initializeProjectControlMailbox(fakeWindow);
    await setProjectControlMailbox({ id: "test-project", dir });

    const responsesDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.responses);
    const requestsDir = join(dir, LOCAL_CONTROL_RUNTIME.dir, LOCAL_CONTROL_RUNTIME.requests);
    // A bare deletion event: create an empty marker with a valid request name
    // and remove it immediately. Whether the watcher sees the create, the
    // delete, or both, no ENOENT error response may appear. (If the create is
    // seen first the empty file fails JSON parsing, which is a *legitimate*
    // error response — so use an unparsable-but-present window of zero by
    // deleting before writing any content is even possible to observe.)
    const id = randomUUID();
    const path = join(requestsDir, `${id}.json`);
    await writeFile(path, "");
    await rm(path, { force: true });

    await sleep(500);
    const leftover = (await readdir(responsesDir)).filter((name) => name === `${id}.json`);
    if (leftover.length === 1) {
      // The watcher won the race and read the (empty) file before deletion:
      // then the error must be about the content, never about ENOENT.
      const response = JSON.parse(await readFile(join(responsesDir, `${id}.json`), "utf8")) as LocalControlResponse;
      assert.equal(response.ok, false);
      assert.ok(!/ENOENT/i.test((response as { error: string }).error), "a vanished request must not be answered with ENOENT");
    } else {
      assert.deepEqual(leftover, [], "a vanished request is not answered at all");
    }
  } finally {
    await stopProjectControlMailbox();
    await rm(dir, { recursive: true, force: true });
  }
});
