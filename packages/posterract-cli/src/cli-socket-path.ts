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
export const SOCKET_PATH =
  platform() === "win32"
    ? `\\\\.\\pipe\\posterract-editor-${createHash("sha256").update(homedir()).digest("hex").slice(0, 12)}`
    : join(tmpdir(), `posterract-editor-${typeof process.getuid === "function" ? process.getuid() : "user"}.sock`);
