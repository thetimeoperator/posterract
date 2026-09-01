/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'somoto';
import {
  LOCAL_AGENT_LABELS,
  normalizeLocalAgentConnectionState,
  type LocalAgentConnectionState,
  type LocalAgentEntry,
  type LocalAgentKind,
} from "@posterract/contract/local-agent";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { mainBridge } from "@/lib/ipc";
import { useProject } from "@/context/project";

const AGENT_LABELS: Record<LocalAgentKind, string> = { ...LOCAL_AGENT_LABELS, terminal: "Other agent" };

/**
 * Connecting an agent is two different jobs that used to be presented as one.
 * Registering a client is global and happens once in a user's life; opening a
 * project in it happens constantly. So the list is the control: a row is
 * always "open this project in that client", and the one-time registration is
 * folded into the first click rather than given a step of its own.
 */
export function PosterractCodePanel() {
  const project = useProject();
  const [busy, setBusy] = createSignal<LocalAgentKind | null>(null);
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<LocalAgentConnectionState>();

  const agents = createMemo(() => state()?.agents ?? []);
  const connected = createMemo(() => state()?.bridge.state === "active");
  const lastUsed = createMemo(() => state()?.selectedAgent ?? "codex");

  /**
   * Registration is global, so a client is only ever "not set up" once. The
   * row says what the click will do rather than making the user find a setup
   * screen first.
   */
  const actionFor = (entry: LocalAgentEntry): { label: string; enabled: boolean } => {
    if (!entry.installed) return { label: "not installed", enabled: false };
    if (!entry.registered) return { label: "set up and open", enabled: true };
    return { label: "open", enabled: true };
  };

  const openIn = async (kind: LocalAgentKind) => {
    if (busy()) return;
    setBusy(kind);
    try {
      // Publish the exact open project first: without it the launch can race
      // stale main-process state and appear to do nothing.
      await mainBridge.call(MAIN_CHANNELS.AGENT_SET_ACTIVE_PROJECT, { dir: project.dir() });
      const next = await mainBridge.call(MAIN_CHANNELS.AGENT_LAUNCH, { agent: kind });
      setState(normalizeLocalAgentConnectionState(next));
      setOpen(false);
      toast.success(`${AGENT_LABELS[kind]} opened in ${project.name()}`, {
        description: "Ask it about this video. Its first tool call confirms the connection.",
      });
    } catch (cause) {
      toast.error(`Could not open ${AGENT_LABELS[kind]}`, {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(null);
    }
  };

  onMount(() => {
    void mainBridge.call(MAIN_CHANNELS.AGENT_GET_STATUS, undefined)
      .then((next) => setState(normalizeLocalAgentConnectionState(next)))
      .catch(() => undefined);
    const stopStatus = mainBridge.handle(
      MAIN_CHANNELS.AGENT_CONNECTION_CHANGED,
      (next) => setState(normalizeLocalAgentConnectionState(next)),
    );
    // The shortcut skips the list and reopens whichever client was used last.
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      void openIn(lastUsed());
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      stopStatus();
      window.removeEventListener("keydown", onKey);
    });
  });

  return (
    <Popover open={open()} onOpenChange={setOpen} placement="top-start">
      <PopoverTrigger
        class="posterract-code-toggle"
        classList={{ "is-active": connected() }}
        title={`${project.name()} · ${connected() ? "agent connected" : "connect an agent"}`}
        aria-label="Open this project in a coding agent"
      >
        <span>AI</span>
        {connected() ? "Agent · Connected" : "Agent"}
        <kbd>⇧⌘O</kbd>
      </PopoverTrigger>

      <PopoverContent class="w-80 p-0">
        <Show when={connected()}>
          <div class="flex items-center gap-2 border-b px-3 py-2.5 text-xs">
            <span class="size-1.5 rounded-full bg-emerald-400" />
            <span class="text-foreground">
              {AGENT_LABELS[lastUsed()]} is editing {project.name()}
            </span>
          </div>
        </Show>

        <div class="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Open this project in
        </div>

        <div class="pb-2">
          <For each={agents()}>
            {(entry) => {
              const action = createMemo(() => actionFor(entry));
              return (
                <button
                  type="button"
                  disabled={!action().enabled || busy() !== null}
                  onClick={() => void openIn(entry.kind)}
                  class="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-accent disabled:opacity-45 disabled:hover:bg-transparent"
                >
                  <span class="text-foreground">{AGENT_LABELS[entry.kind]}</span>
                  <span class="shrink-0 text-[10px] text-muted-foreground">
                    {busy() === entry.kind ? "opening…" : action().label}
                  </span>
                </button>
              );
            }}
          </For>
        </div>

        {/*
          Only one project can hold the local connection at a time, so opening
          an agent here takes it from whichever project had it. Saying so is
          the difference between a surprise and a choice.
        */}
        <Show when={state()?.activeProject && state()!.activeProject!.dir !== project.dir()}>
          <div class="flex gap-2 border-t px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Icon name="alert-warning" class="size-4 shrink-0" />
            <span>
              {state()!.activeProject!.name} currently holds the agent connection. Opening one here
              disconnects it.
            </span>
          </div>
        </Show>
      </PopoverContent>
    </Popover>
  );
}
