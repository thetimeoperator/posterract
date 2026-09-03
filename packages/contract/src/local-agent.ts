export const LOCAL_AGENT_KINDS = ["codex", "claude", "cursor", "vscode", "terminal"] as const;

export type LocalAgentKind = (typeof LOCAL_AGENT_KINDS)[number];

export type LocalAgentBridgeState =
  | "setup_required"
  | "waiting"
  | "ready"
  | "active"
  | "idle"
  | "error"
  | "update_required";

/**
 * One supported client's standing on this machine. Registration is global and
 * one-time, so `registered` is true in every project once it is true anywhere;
 * `installed` is false when the client itself was not found, which is the only
 * case where a row cannot be acted on.
 */
export type LocalAgentEntry = {
  kind: LocalAgentKind;
  label: string;
  installed: boolean;
  registered: boolean;
};

export type LocalAgentConnectionState = {
  environment: "web" | "desktop";
  /** Every supported client and what it would take to open this project in it. */
  agents: LocalAgentEntry[];
  /** The client opened most recently, for the keyboard shortcut's default. */
  selectedAgent: LocalAgentKind;
  activeProject: {
    id: string;
    name: string;
    dir: string;
  } | null;
  cli: {
    installed: boolean;
    path: string | null;
    version: string | null;
    compatible: boolean;
  };
  integration: {
    method: "plugin" | "mcp_config" | "manual";
    installed: boolean;
    version: string | null;
    client: LocalAgentKind;
    error: string | null;
  };
  mcp: {
    available: boolean;
    configured: boolean;
    client: LocalAgentKind;
    projectDir: string | null;
    serverVersion: string | null;
    toolCount: number | null;
    verifiedAt: number | null;
    error: string | null;
  };
  guidance: {
    projectInstructionsPresent: boolean;
    skillAvailable: boolean;
    skillVersion: string | null;
    installed: boolean;
  };
  bridge: {
    state: LocalAgentBridgeState;
    lastSeenAt: number | null;
    lastCommand: string | null;
    error: string | null;
    /**
     * What the agent has done, newest first.
     *
     * The bridge is otherwise invisible: an agent edits the canvas and the
     * only trace is the canvas changing. A log is what lets someone see that
     * a turn happened, what it touched, and decide whether to keep it.
     */
    activity: LocalAgentActivityEntry[];
  };
};

/** One recorded tool call. */
export type LocalAgentActivityEntry = {
  /** The tool, without its `mcp:` prefix — `set_properties`, `capture`, … */
  command: string;
  at: number;
  /** The element ids it named, when the tool names any. */
  targets: string[];
};

/** How many calls the log keeps. Enough to see a turn, not a session. */
export const LOCAL_AGENT_ACTIVITY_LIMIT = 50;

export type LocalAgentActivity = {
  cliVersion: string;
  command: string;
  projectDir: string;
  invokedAt: number;
  /** The element ids the call named, so the log can point at them. */
  targets?: string[];
};

export type LocalAgentConnectionInternals = {
  verifiedAt: number | null;
  launchedAt?: number | null;
  error: string | null;
  now?: number;
};

export const LOCAL_AGENT_ACTIVE_WINDOW_MS = 60_000;
export const LOCAL_AGENT_LAUNCH_WINDOW_MS = 10 * 60_000;

export function isLocalAgentKind(value: unknown): value is LocalAgentKind {
  return typeof value === "string" && (LOCAL_AGENT_KINDS as readonly string[]).includes(value);
}

export function deriveLocalAgentBridgeState(
  state: Pick<LocalAgentConnectionState, "activeProject" | "cli" | "integration" | "mcp" | "guidance" | "bridge">,
  internals: LocalAgentConnectionInternals,
): LocalAgentBridgeState {
  const now = internals.now ?? Date.now();

  // A completed tool call is the only direct evidence that an agent reached
  // the canvas. It outranks every configuration check below, which are all
  // proxies for this and can disagree with it (a hand-edited config, a client
  // that reads from somewhere Posterract does not manage, a stale registry).
  if (
    state.bridge.lastSeenAt &&
    state.bridge.lastCommand?.startsWith("mcp:") &&
    now - state.bridge.lastSeenAt <= LOCAL_AGENT_ACTIVE_WINDOW_MS
  ) {
    return "active";
  }

  if (!state.cli.compatible && state.cli.installed) return "update_required";
  if (internals.error) return "error";
  // Project guidance and the bundled skill improve agent output but do not
  // gate the connection; a configured client can reach the canvas without
  // them, so they are reported as hints rather than blockers.
  if (!state.activeProject || !state.cli.installed || !state.integration.installed || !state.mcp.configured) {
    return "setup_required";
  }
  if (
    internals.launchedAt &&
    now - internals.launchedAt <= LOCAL_AGENT_LAUNCH_WINDOW_MS &&
    (!state.bridge.lastSeenAt || state.bridge.lastSeenAt < internals.launchedAt)
  ) {
    return "waiting";
  }
  if (!internals.verifiedAt) return "setup_required";
  if (now - internals.verifiedAt <= LOCAL_AGENT_ACTIVE_WINDOW_MS) return "ready";
  return "idle";
}

export function webLocalAgentConnectionState(): LocalAgentConnectionState {
  return {
    environment: "web",
    agents: LOCAL_AGENT_KINDS.map((kind) => ({
      kind,
      label: LOCAL_AGENT_LABELS[kind],
      installed: false,
      registered: false,
    })),
    selectedAgent: "codex",
    activeProject: null,
    cli: { installed: false, path: null, version: null, compatible: false },
    integration: {
      method: "plugin",
      installed: false,
      version: null,
      client: "codex",
      error: null,
    },
    mcp: {
      available: false,
      configured: false,
      client: "codex",
      projectDir: null,
      serverVersion: null,
      toolCount: null,
      verifiedAt: null,
      error: null,
    },
    guidance: {
      projectInstructionsPresent: false,
      skillAvailable: true,
      skillVersion: null,
      installed: false,
    },
    bridge: {
      state: "setup_required",
      lastSeenAt: null,
      lastCommand: null,
      error: null,
      activity: [],
    },
  };
}

/**
 * The activity log as it comes off disk or the wire.
 *
 * Entries are data a previous build wrote, so every field is checked; a
 * malformed one is dropped rather than rendered as `undefined` in the panel.
 */
function normalizeActivity(value: unknown): LocalAgentActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LocalAgentActivityEntry[] = [];
  for (const item of value) {
    const entry = item as Partial<LocalAgentActivityEntry> | null;
    if (!entry || typeof entry.command !== "string" || typeof entry.at !== "number") continue;
    entries.push({
      command: entry.command,
      at: entry.at,
      targets: Array.isArray(entry.targets) ? entry.targets.filter((id) => typeof id === "string") : [],
    });
    if (entries.length >= LOCAL_AGENT_ACTIVITY_LIMIT) break;
  }
  return entries;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Desktop and web can be upgraded independently. Normalize the wire payload
 * before any UI reads it so an older desktop build cannot crash a newer API
 * page when a newly-added section (such as `mcp`) is absent.
 */
export function normalizeLocalAgentConnectionState(value: unknown): LocalAgentConnectionState {
  const fallback = webLocalAgentConnectionState();
  const input = objectValue(value);
  if (!input) return fallback;

  const environment = input.environment === "desktop" ? "desktop" : "web";
  const selectedAgent = isLocalAgentKind(input.selectedAgent) ? input.selectedAgent : fallback.selectedAgent;
  const project = objectValue(input.activeProject);
  const cli = objectValue(input.cli);
  const integration = objectValue(input.integration);
  const mcp = objectValue(input.mcp);
  const guidance = objectValue(input.guidance);
  const bridge = objectValue(input.bridge);
  const compatibleBridgeStates: readonly LocalAgentBridgeState[] = [
    "setup_required",
    "waiting",
    "ready",
    "active",
    "idle",
    "error",
    "update_required",
  ];
  const missingDesktopMcp = environment === "desktop" && !mcp;

  const agents = Array.isArray(input.agents)
    ? input.agents
        .map((value) => objectValue(value))
        .filter((value): value is Record<string, unknown> => value !== null && isLocalAgentKind(value.kind))
        .map((value) => ({
          kind: value.kind as LocalAgentKind,
          label: typeof value.label === "string" ? value.label : LOCAL_AGENT_LABELS[value.kind as LocalAgentKind],
          installed: value.installed === true,
          registered: value.registered === true,
        }))
    : fallback.agents;

  return {
    environment,
    agents: agents.length ? agents : fallback.agents,
    selectedAgent,
    activeProject:
      project && typeof project.id === "string" && typeof project.name === "string" && typeof project.dir === "string"
        ? { id: project.id, name: project.name, dir: project.dir }
        : null,
    cli: {
      installed: typeof cli?.installed === "boolean" ? cli.installed : false,
      path: typeof cli?.path === "string" ? cli.path : null,
      version: typeof cli?.version === "string" ? cli.version : null,
      compatible: typeof cli?.compatible === "boolean" ? cli.compatible : false,
    },
    integration: {
      method:
        integration?.method === "mcp_config" || integration?.method === "manual"
          ? integration.method
          : "plugin",
      installed: typeof integration?.installed === "boolean" ? integration.installed : false,
      version: typeof integration?.version === "string" ? integration.version : null,
      client: isLocalAgentKind(integration?.client) ? integration.client : selectedAgent,
      error: typeof integration?.error === "string" ? integration.error : null,
    },
    mcp: {
      available: typeof mcp?.available === "boolean" ? mcp.available : false,
      configured: typeof mcp?.configured === "boolean" ? mcp.configured : false,
      client: isLocalAgentKind(mcp?.client) ? mcp.client : selectedAgent,
      projectDir: typeof mcp?.projectDir === "string" ? mcp.projectDir : null,
      serverVersion: typeof mcp?.serverVersion === "string" ? mcp.serverVersion : null,
      toolCount: typeof mcp?.toolCount === "number" ? mcp.toolCount : null,
      verifiedAt: typeof mcp?.verifiedAt === "number" ? mcp.verifiedAt : null,
      error: typeof mcp?.error === "string" ? mcp.error : null,
    },
    guidance: {
      projectInstructionsPresent:
        typeof guidance?.projectInstructionsPresent === "boolean" ? guidance.projectInstructionsPresent : false,
      skillAvailable: typeof guidance?.skillAvailable === "boolean" ? guidance.skillAvailable : false,
      skillVersion: typeof guidance?.skillVersion === "string" ? guidance.skillVersion : null,
      installed: typeof guidance?.installed === "boolean" ? guidance.installed : false,
    },
    bridge: {
      state: missingDesktopMcp
        ? "update_required"
        : typeof bridge?.state === "string" && compatibleBridgeStates.includes(bridge.state as LocalAgentBridgeState)
          ? bridge.state as LocalAgentBridgeState
          : "setup_required",
      lastSeenAt: typeof bridge?.lastSeenAt === "number" ? bridge.lastSeenAt : null,
      lastCommand: typeof bridge?.lastCommand === "string" ? bridge.lastCommand : null,
      error: missingDesktopMcp
        ? "This Posterract Desktop build predates the MCP connection interface. Install the current desktop build to connect an agent."
        : typeof bridge?.error === "string" ? bridge.error : null,
      activity: normalizeActivity(bridge?.activity),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Guided connection steps
 *
 * The desktop panel walks the user through connecting an agent. Every
 * step is derived from the same wire state the panel already receives,
 * so there is exactly one description of "where am I" and no second
 * protocol to keep in sync.
 * ------------------------------------------------------------------ */

export const LOCAL_AGENT_STEP_IDS = ["project", "runtime", "integration", "restart", "handshake"] as const;

export type LocalAgentStepId = (typeof LOCAL_AGENT_STEP_IDS)[number];

/**
 * `blocked` is a step that cannot proceed until the user resolves something
 * (an incompatible CLI, a hand-edited config). `current` is the one step the
 * panel asks for next.
 */
export type LocalAgentStepStatus = "done" | "current" | "pending" | "blocked";

export type LocalAgentStep = {
  id: LocalAgentStepId;
  title: string;
  /** What this step means, in the user's terms. */
  detail: string;
  status: LocalAgentStepStatus;
  /** True when the user must act outside Posterract; Posterract cannot do it for them. */
  manual: boolean;
};

export const LOCAL_AGENT_LABELS: Record<LocalAgentKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  terminal: "your agent",
};

/**
 * An agent only reads its MCP configuration when it starts. Registering the
 * server is therefore never enough on its own — the client has to be
 * restarted before it can see Posterract. This is the step users miss, so it
 * is modelled explicitly rather than folded into "configured".
 */
export function agentHasLoadedPosterract(state: LocalAgentConnectionState): boolean {
  return Boolean(state.bridge.lastSeenAt && state.bridge.lastCommand?.startsWith("mcp:"));
}

export function deriveLocalAgentSteps(state: LocalAgentConnectionState): LocalAgentStep[] {
  const agent = LOCAL_AGENT_LABELS[state.selectedAgent];
  const projectReady = Boolean(state.activeProject);
  const runtimeReady = state.cli.installed && state.cli.compatible;
  const runtimeBlocked = state.cli.installed && !state.cli.compatible;
  const integrationReady = state.integration.installed && state.integration.client === state.selectedAgent;
  const loaded = agentHasLoadedPosterract(state);
  const connected = state.bridge.state === "active";

  // Each step is `current` only when every step before it is done, so the
  // panel always points at exactly one action.
  const step = (
    id: LocalAgentStepId,
    title: string,
    detail: string,
    done: boolean,
    reachable: boolean,
    manual = false,
    blocked = false,
  ): LocalAgentStep => ({
    id,
    title,
    detail,
    manual,
    status: blocked ? "blocked" : done ? "done" : reachable ? "current" : "pending",
  });

  return [
    step(
      "project",
      "Open a video project",
      projectReady
        ? `${state.activeProject?.name} is open. Your agent will edit this project's code and canvas.`
        : "Create or open a project first. It is a folder on this computer, and its code is what the canvas renders.",
      projectReady,
      true,
      true,
    ),
    step(
      "runtime",
      "Install the Posterract command",
      runtimeBlocked
        ? `The installed posterract command is v${state.cli.version ?? "unknown"} and does not match this app. Reconnect to update it.`
        : runtimeReady
          ? `posterract v${state.cli.version ?? "current"} is installed. This is the program your agent will run.`
          : "Posterract installs a small command on this computer. Your agent runs it to reach the canvas.",
      runtimeReady,
      projectReady,
      false,
      runtimeBlocked,
    ),
    step(
      "integration",
      `Register Posterract with ${agent}`,
      state.selectedAgent === "terminal"
        ? integrationReady
          ? "The MCP configuration was written into this project. Paste it into your agent if it reads config from elsewhere."
          : "Posterract writes a standard MCP configuration into this project for you to import."
        : integrationReady
          ? `${agent} is configured to launch Posterract. This applies to every project you open.`
          : `Posterract adds itself to ${agent}'s MCP configuration. Nothing is sent anywhere — it just records which command to run.`,
      integrationReady,
      projectReady && runtimeReady,
    ),
    step(
      "restart",
      `Start ${agent} in this project`,
      loaded
        ? `${agent} has loaded Posterract.`
        : `Posterract opens a new ${agent} session for you, because a client only reads its configuration at startup. Any ${agent} window you already had open will not see the tools until you restart that one yourself.`,
      loaded,
      projectReady && runtimeReady && integrationReady,
    ),
    step(
      "handshake",
      "Your agent calls the canvas",
      connected
        ? `${agent} called ${state.bridge.lastCommand?.replace(/^mcp:/, "") ?? "a Posterract tool"}. It has live control of this project.`
        : `Ask ${agent} to describe the current video. Its first tool call is what proves the connection — nothing else does.`,
      connected,
      projectReady && runtimeReady && integrationReady && loaded,
      true,
    ),
  ];
}

/** The one step the panel should ask for next, if any remain. */
export function currentLocalAgentStep(steps: LocalAgentStep[]): LocalAgentStep | undefined {
  return steps.find((item) => item.status === "blocked") ?? steps.find((item) => item.status === "current");
}
