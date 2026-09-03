/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'somoto';
import {
  LOCAL_AGENT_LABELS,
  type LocalAgentActivityEntry,
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
import { AGENT_RECIPES, type AgentRecipe } from "@/engine/agent-recipes";
import { useWorld } from "@posterract/koota-solid";
import { getDocumentEditor } from "@/engine/editor";
import { resolveNode } from "@/context/agent-api/nodes";

import type { Entity } from "koota";

const AGENT_LABELS: Record<LocalAgentKind, string> = { ...LOCAL_AGENT_LABELS, terminal: "Other agent" };

/** How long ago, short enough to sit at the end of a row. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/**
 * Connecting an agent is two different jobs that used to be presented as one.
 * Registering a client is global and happens once in a user's life; opening a
 * project in it happens constantly. So the list is the control: a row is
 * always "open this project in that client", and the one-time registration is
 * folded into the first click rather than given a step of its own.
 */
export function PosterractCodePanel() {
  const project = useProject();
  const world = useWorld();
  const [busy, setBusy] = createSignal<LocalAgentKind | null>(null);
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<LocalAgentConnectionState>();

  const agents = createMemo(() => state()?.agents ?? []);
  const connected = createMemo(() => state()?.bridge.state === "active");
  const lastUsed = createMemo(() => state()?.selectedAgent ?? "codex");
  const activity = createMemo(() => state()?.bridge.activity ?? []);

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

  const copyRecipe = async (recipe: AgentRecipe) => {
    try {
      await navigator.clipboard.writeText(recipe.prompt);
      toast.success(`"${recipe.label}" copied`, {
        description: `Paste it into ${AGENT_LABELS[lastUsed()]} — it already has this project.`,
      });
      setOpen(false);
    } catch {
      toast.error("Could not copy that", { description: "Your browser refused clipboard access." });
    }
  };

  /**
   * Show me what that call touched.
   *
   * Ids that no longer resolve are skipped rather than failing the click: an
   * element the agent created and then replaced is a normal thing to find in
   * a log, and the rest of the row is still worth selecting.
   */
  const selectTargets = (entry: LocalAgentActivityEntry) => {
    if (!entry.targets.length) return;
    const found: Entity[] = [];
    for (const id of entry.targets) {
      try {
        found.push(resolveNode(world, id));
      } catch {
        // Gone since — see above.
      }
    }
    if (!found.length) {
      toast("Those elements are gone", {
        description: "The edit that named them has since been undone or replaced.",
      });
      return;
    }
    getDocumentEditor(world).select(found);
    setOpen(false);
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
          An agent loads MCP servers and skills when its session starts, so
          the first connection is invisible until the next session. Nothing
          told people that; they assumed the connection had failed, or the
          agent edited the file directly because it never saw the tools.
        */}
        <Show when={!connected()}>
          <div class="border-t px-3 py-2 text-[10px] leading-snug text-muted-foreground">
            First time? Start a new agent session after connecting so it loads the Posterract tools.
            When it is talking to the canvas, this button turns green.
          </div>
        </Show>

        {/*
          The hardest part of working with an agent is knowing what to ask
          for. A recipe is copied rather than sent: the user already has a
          session open — that is what "connected" means — and pasting into it
          keeps the conversation theirs, in the client they chose, instead of
          this panel trying to drive five different CLIs.
        */}
        <div class="border-t">
          <div class="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ask it to
          </div>
          <div class="pb-2">
            <For each={AGENT_RECIPES}>
              {(recipe) => (
                <button
                  type="button"
                  onClick={() => void copyRecipe(recipe)}
                  class="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent"
                >
                  <span class="text-xs text-foreground">{recipe.label}</span>
                  <span class="text-[10px] leading-tight text-muted-foreground">{recipe.hint}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        {/*
          What the agent has actually done. The bridge is otherwise invisible —
          an agent edits and the only trace is the canvas changing — so this is
          how someone sees a turn happened and what it touched. Clicking a row
          selects those elements, which is the fastest way to check a change.
        */}
        <Show when={activity().length > 0}>
          <div class="border-t">
            <div class="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </div>
            <div class="max-h-44 overflow-y-auto pb-2">
              <For each={activity().slice(0, 20)}>
                {(entry) => (
                  <button
                    type="button"
                    disabled={entry.targets.length === 0}
                    onClick={() => selectTargets(entry)}
                    class="w-full flex items-baseline gap-2 px-3 py-1 text-left text-[11px] hover:bg-accent disabled:hover:bg-transparent"
                  >
                    <span class="font-mono text-foreground">{entry.command}</span>
                    <Show when={entry.targets.length}>
                      <span class="min-w-0 flex-1 truncate text-muted-foreground">
                        {entry.targets.join(", ")}
                      </span>
                    </Show>
                    <span class="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      {ago(entry.at)}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

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
