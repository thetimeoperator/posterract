/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAIN_CHANNELS, MAIN_WIRE } from "@desktop/main-channels";
import type {
  MainEvent,
  MainEventChannel,
  MainEventMap,
  MainReply,
  MainRequest,
  MainRequestChannel,
  MainRequestMap,
} from "@desktop/main-channels";
import { CLI_WIRE } from "@posterract/cli/channels";
import { CLI_PROTOCOL_VERSION } from "@posterract/cli/channels";
import type { CliRendererReply, CliRendererRequest, CliReply } from "@posterract/cli/channels";
import type { CliActivityMetadata } from "@posterract/cli/channels";

type EventHandler<C extends MainEventChannel> = (data: MainEventMap[C]) => void;

export type ProcedureCaller = (input: unknown) => Promise<unknown>;

// Resolves a dot-joined tRPC procedure path to an invocable, or undefined
// when the router doesn't own that path.
export type RouterCaller = (path: string) => ProcedureCaller | undefined;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

// Renderer↔main bridge. Symmetric with cliBridge: `handle` registers a
// single-subscriber receiver for inbound channels (events from main); `call`
// sends a request to main and awaits the reply.
class MainBridge {
  private pending = new Map<string, Pending>();
  private eventHandlers = new Map<MainEventChannel, EventHandler<MainEventChannel>>();
  private bound = false;

  private bind(): void {
    if (this.bound || !window.desktop) return;
    this.bound = true;

    window.desktop.on(MAIN_WIRE.RESPONSE, (payload) => {
      const reply = payload as MainReply;
      const entry = this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.data);
      else entry.reject(new Error(reply.error));
    });

    window.desktop.on(MAIN_WIRE.EVENT, (payload) => {
      const envelope = payload as MainEvent;
      const handler = this.eventHandlers.get(envelope.channel);
      if (!handler) return;
      try {
        handler(envelope.data as never);
      } catch (err) {
        console.error(`[main-bridge] handler for ${envelope.channel} threw`, err);
      }
    });
  }

  call<C extends MainRequestChannel>(
    channel: C,
    data: MainRequestMap[C]["request"],
  ): Promise<MainRequestMap[C]["response"]> {
    if (!window.desktop) {
      return Promise.reject(new Error("Main bridge unavailable: not running in desktop"));
    }
    this.bind();
    const id = crypto.randomUUID();
    const envelope: MainRequest = { id, channel, data };
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      window.desktop!.send(MAIN_WIRE.REQUEST, envelope);
    });
  }

  handle<C extends MainEventChannel>(channel: C, handler: EventHandler<C>): () => void {
    if (!window.desktop) return () => {};
    this.bind();
    const stored = handler as EventHandler<MainEventChannel>;
    this.eventHandlers.set(channel, stored);
    return () => {
      if (this.eventHandlers.get(channel) === stored) {
        this.eventHandlers.delete(channel);
      }
    };
  }
}

export const mainBridge = new MainBridge();

type PendingCliRequest = {
  envelope: CliRendererRequest;
  activity?: CliActivityMetadata;
};

// CLI bridge — answers requests relayed by the desktop-owned per-user socket.
// The CLI is only a client; the renderer returns each reply to desktop main
// over IPC. Requests arriving before their router mounts are held and retried
// on the next registration.
class CliBridge {
  // Several routers coexist: the shell router (always mounted, owns `ping`
  // and `open`) and the editor router (mounted per open project). Paths are
  // disjoint; a request is answered by whichever router owns its path.
  private routers = new Set<RouterCaller>();
  private pending: PendingCliRequest[] = [];

  private receive(payload: unknown): void {
    const envelope = payload as CliRendererRequest;
    const { protocolVersion, id, token, request, activity } = envelope;
    if (protocolVersion !== CLI_PROTOCOL_VERSION) {
      console.error(`[cli-bridge] incompatible protocol ${protocolVersion}`);
      return;
    }
    if (!id || !token || !request || typeof request.path !== "string") {
      console.error("[cli-bridge] malformed CLI request");
      return;
    }
    void this.dispatch({ envelope, activity });
  }

  constructor() {
    // Bind eagerly so request arrivals during page bootstrap are caught
    // rather than silently dropped before any router registers.
    if (window.desktop) {
      window.desktop.on(CLI_WIRE.REQUEST, (payload) => this.receive(payload));
    }
    // The desktop shell queues CLI requests received while the user is on
    // another screen, opens Create, then hands the one-time connection to the
    // newly mounted editor iframe through this local-only message.
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || event.data?.type !== "posterract-cli-request") return;
      this.receive(event.data.payload);
    });
  }

  private resolve(path: string): ProcedureCaller | undefined {
    for (const router of this.routers) {
      const proc = router(path);
      if (proc) return proc;
    }
    return undefined;
  }

  private async dispatch(pending: PendingCliRequest): Promise<void> {
    const { request: req } = pending.envelope;
    const proc = this.resolve(req.path);
    if (!proc) {
      this.pending.push(pending);
      return;
    }
    let reply: CliReply;
    try {
      const data = await proc(req.input);
      reply = { ok: true, data };
    } catch (err) {
      reply = { ok: false, error: (err as Error).message };
    }
    try {
      // Preserve the CLI's JSON output contract and fail cleanly before
      // crossing Electron IPC if a procedure returned a non-serializable value.
      JSON.stringify(reply);
    } catch (err) {
      reply = {
        ok: false,
        error: `Failed to serialize reply for ${req.path}: ${(err as Error).message}`,
      };
    }

    const response: CliRendererReply = {
      protocolVersion: CLI_PROTOCOL_VERSION,
      id: pending.envelope.id,
      token: pending.envelope.token,
      reply,
    };
    if (window.desktop) {
      window.desktop.send(CLI_WIRE.RESPONSE, response);
    } else {
      window.parent.postMessage({ type: "posterract-cli-response", payload: response }, "*");
    }

    if (reply.ok && pending.activity) {
      void mainBridge.call(MAIN_CHANNELS.AGENT_RECORD_ACTIVITY, pending.activity).catch((error) => {
        console.warn("[cli-bridge] could not report successful CLI activity", error);
      });
    }
  }

  register(router: RouterCaller): () => void {
    if (!window.desktop) return () => {};
    this.routers.add(router);
    const held = this.pending;
    this.pending = [];
    for (const pending of held) void this.dispatch(pending);
    return () => {
      this.routers.delete(router);
    };
  }
}

export const cliBridge = new CliBridge();
