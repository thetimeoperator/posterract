/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { connect } from "node:net";
import { createTRPCClient, TRPCClientError } from "@trpc/client";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AnyRouter } from "@trpc/server";
import { CLI_PROTOCOL_VERSION, SOCKET_PATH } from "./protocol";
import type { CliRequest, CliSocketReply, CliSocketRequest } from "./protocol";
import { version as cliVersion } from "../package.json";

const DEFAULT_TIMEOUT_MS = 60000;
export const GENERATE_TIMEOUT_MS = 600000;

// One command is one request/reply over the desktop-owned local socket. The
// CLI never opens a listener, which keeps it compatible with sandboxed coding
// agents that may connect to local IPC but cannot bind TCP ports.
function transport(request: CliRequest, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(SOCKET_PATH);
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

// Terminating link: each operation uses one short-lived local socket. Long-
// running procedures pass { context: { timeoutMs } } at the call site.
const cliLink: TRPCLink<AnyRouter> =
  () =>
  ({ op }) =>
    observable((observer) => {
      const timeoutMs =
        typeof op.context.timeoutMs === "number" ? op.context.timeoutMs : DEFAULT_TIMEOUT_MS;
      transport({ path: op.path, input: op.input }, timeoutMs)
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
