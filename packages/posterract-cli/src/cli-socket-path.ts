/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

// One socket / named pipe per host. On macOS tmpdir is per-user; on Linux /tmp
// is global but the socket file's owner-only mode 0600 keeps it isolated.
//
// Kept separate from cli-channels so the renderer can import the channel
// registry and envelope types without pulling in node:os / node:path.
//
// `POSTERRACT_PROFILE` names a second, fully separate instance of the app — its
// own user data, its own socket, its own active-project pointer — so a test or
// headless instance can run beside the one the user has open without taking
// its socket away. Unset (the normal case) changes nothing. The CLI and the
// app both read it, so a CLI run with the same profile reaches that instance.
const PROFILE = (process.env.POSTERRACT_PROFILE ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);

/** The instance profile in effect, or "" for the user's own app. */
export const INSTANCE_PROFILE = PROFILE;

/** The socket (or named pipe) of the instance running under `profile`; "" is the user's own app. */
export function socketPathFor(profile: string): string {
  const suffix = profile ? `-${profile}` : "";
  return platform() === "win32"
    ? `\\\\.\\pipe\\posterract-editor-${createHash("sha256").update(homedir()).digest("hex").slice(0, 12)}${suffix}`
    : join(tmpdir(), `posterract-editor-${typeof process.getuid === "function" ? process.getuid() : "user"}${suffix}.sock`);
}

export const SOCKET_PATH = socketPathFor(PROFILE);

/**
 * The profile of the engine: an instance of the app with no window, which the
 * CLI starts for itself when it is asked for something only the renderer can do
 * and the app is not open (see cli-client's `ensureEngine`, and the desktop's
 * `--engine`).
 */
export const ENGINE_PROFILE = "engine";
export const ENGINE_SOCKET_PATH = socketPathFor(ENGINE_PROFILE);
