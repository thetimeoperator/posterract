import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_AGENT_KINDS,
  currentLocalAgentStep,
  deriveLocalAgentBridgeState,
  deriveLocalAgentSteps,
  normalizeLocalAgentConnectionState,
  webLocalAgentConnectionState,
  type LocalAgentConnectionState,
  type LocalAgentStepId,
} from "@posterract/contract/local-agent";

function configuredState(): LocalAgentConnectionState {
  return {
    environment: "desktop",
    agents: [
      { kind: "codex", label: "Codex", installed: true, registered: true },
      { kind: "claude", label: "Claude Code", installed: true, registered: false },
      { kind: "cursor", label: "Cursor", installed: false, registered: false },
      { kind: "vscode", label: "VS Code", installed: false, registered: false },
      { kind: "terminal", label: "your agent", installed: true, registered: false },
    ],
    selectedAgent: "codex",
    activeProject: { id: "project-1", name: "Launch", dir: "/tmp/launch" },
    cli: { installed: true, path: "/usr/local/bin/posterract", version: "0.201.0", compatible: true },
    integration: { method: "mcp_config", installed: true, version: "0.201.0", client: "codex", error: null },
    mcp: {
      available: true,
      configured: true,
      client: "codex",
      projectDir: "/tmp/launch",
      serverVersion: "0.201.0",
      toolCount: 24,
      verifiedAt: null,
      error: null,
    },
    guidance: {
      projectInstructionsPresent: true,
      skillAvailable: true,
      skillVersion: "0.1.0",
      installed: true,
    },
    bridge: { state: "setup_required", lastSeenAt: null, lastCommand: null, error: null },
  };
}

test("browser state never claims a local connection", () => {
  const state = webLocalAgentConnectionState();
  assert.equal(state.environment, "web");
  assert.equal(state.bridge.state, "setup_required");
  assert.equal(state.cli.installed, false);
});

test("missing project or guidance remains setup required", () => {
  const state = configuredState();
  state.activeProject = null;
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: Date.now(), error: null }), "setup_required");
});

test("an incompatible installed CLI requires an update", () => {
  const state = configuredState();
  state.cli.compatible = false;
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: null, error: null }), "update_required");
});

test("the latest connection failure is reported", () => {
  const state = configuredState();
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: null, error: "bridge failed" }), "error");
});

test("a successful end-to-end test reaches ready without claiming agent activity", () => {
  const now = 10_000;
  const state = configuredState();
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: now - 500, error: null, now }), "ready");
});

test("opening an agent waits for that agent's first real CLI command", () => {
  const now = 20_000;
  const state = configuredState();
  assert.equal(
    deriveLocalAgentBridgeState(state, { verifiedAt: null, launchedAt: now - 500, error: null, now }),
    "waiting",
  );
});

test("only recent successful CLI activity reaches active", () => {
  const now = 100_000;
  const state = configuredState();
  state.bridge.lastSeenAt = now - 1_000;
  state.bridge.lastCommand = "mcp:get_context";
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: now - 10_000, error: null, now }), "active");
});

test("configured connections expire from active to idle", () => {
  const now = 100_000;
  const state = configuredState();
  state.bridge.lastSeenAt = now - 61_000;
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: now - 61_000, error: null, now }), "idle");
});

test("an older desktop response without mcp never crashes the frontend", () => {
  const legacy = configuredState() as unknown as Record<string, unknown>;
  delete legacy.mcp;
  const state = normalizeLocalAgentConnectionState(legacy);
  assert.equal(state.environment, "desktop");
  assert.equal(state.mcp.configured, false);
  assert.equal(state.bridge.state, "update_required");
  assert.match(state.bridge.error ?? "", /predates the MCP connection interface/);
});

test("malformed connection fields safely fall back", () => {
  const state = normalizeLocalAgentConnectionState({
    environment: "desktop",
    selectedAgent: "unknown",
    cli: null,
    mcp: [],
    bridge: { state: "invented" },
  });
  assert.equal(state.selectedAgent, "codex");
  assert.equal(state.cli.installed, false);
  assert.equal(state.mcp.configured, false);
  assert.equal(state.bridge.state, "update_required");
});

/* A completed tool call is the only direct proof an agent reached the canvas.
   Every configuration check is a proxy for it and may disagree. */
test("a live tool call outranks every configuration check", () => {
  const now = 500_000;
  const state = configuredState();
  state.integration.installed = false;
  state.mcp.configured = false;
  state.guidance.projectInstructionsPresent = false;
  state.bridge.lastSeenAt = now - 2_000;
  state.bridge.lastCommand = "mcp:get_context";
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: null, error: "stale probe", now }), "active");
});

test("missing project guidance no longer blocks a configured connection", () => {
  const now = 500_000;
  const state = configuredState();
  state.guidance.projectInstructionsPresent = false;
  state.guidance.skillAvailable = false;
  assert.equal(deriveLocalAgentBridgeState(state, { verifiedAt: now - 500, error: null, now }), "ready");
});

function stepIds(state: LocalAgentConnectionState): Record<LocalAgentStepId, string> {
  return Object.fromEntries(deriveLocalAgentSteps(state).map((step) => [step.id, step.status])) as Record<
    LocalAgentStepId,
    string
  >;
}

test("the guided steps point at exactly one next action", () => {
  const fresh = webLocalAgentConnectionState();
  const steps = deriveLocalAgentSteps(fresh);
  assert.equal(steps.length, 5);
  assert.equal(steps.filter((step) => step.status === "current").length, 1);
  assert.equal(currentLocalAgentStep(steps)?.id, "project");
});

test("each completed prerequisite advances the current step", () => {
  const state = webLocalAgentConnectionState();
  state.environment = "desktop";
  assert.equal(stepIds(state).project, "current");

  state.activeProject = { id: "p", name: "Launch", dir: "/tmp/launch" };
  assert.equal(stepIds(state).runtime, "current");

  state.cli = { installed: true, path: "/usr/local/bin/posterract", version: "0.203.0", compatible: true };
  assert.equal(stepIds(state).integration, "current");

  state.integration = { method: "mcp_config", installed: true, version: "0.203.0", client: "codex", error: null };
  assert.equal(stepIds(state).restart, "current");
});

/* "You do this" must mean Connect will not: the primary action installs the
   command, registers the client, and starts a session, so only opening a
   project and prompting the agent are left to the user. */
test("only the steps Connect cannot perform are marked manual", () => {
  const manual = deriveLocalAgentSteps(webLocalAgentConnectionState())
    .filter((step) => step.manual)
    .map((step) => step.id);
  assert.deepEqual(manual, ["project", "handshake"]);
});

test("an incompatible runtime blocks its own step rather than a later one", () => {
  const state = configuredState();
  state.cli.compatible = false;
  const steps = stepIds(state);
  assert.equal(steps.runtime, "blocked");
  assert.equal(currentLocalAgentStep(deriveLocalAgentSteps(state))?.id, "runtime");
});

test("only a real agent tool call completes restart and handshake", () => {
  const state = configuredState();
  // The desktop's own smoke test verifies the server, never the agent client.
  state.mcp.verifiedAt = Date.now();
  assert.equal(stepIds(state).restart, "current");

  state.bridge.lastSeenAt = Date.now();
  state.bridge.lastCommand = "mcp:get_context";
  state.bridge.state = "active";
  const steps = stepIds(state);
  assert.equal(steps.restart, "done");
  assert.equal(steps.handshake, "done");
  assert.equal(currentLocalAgentStep(deriveLocalAgentSteps(state)), undefined);
});

/* The popup lists every supported client, and a click acts on that row alone. */
test("each client carries its own installed and registered standing", () => {
  const state = configuredState();
  const byKind = Object.fromEntries(state.agents.map((entry) => [entry.kind, entry]));
  assert.equal(byKind.codex!.registered, true);
  assert.equal(byKind.claude!.registered, false);
  assert.equal(byKind.claude!.installed, true, "an installed but unregistered client is still actionable");
  assert.equal(byKind.cursor!.installed, false, "a client that is absent cannot be set up");
});

test("a missing agents list falls back rather than crashing an older desktop", () => {
  const legacy = configuredState() as unknown as Record<string, unknown>;
  delete legacy.agents;
  const state = normalizeLocalAgentConnectionState(legacy);
  assert.equal(state.agents.length, 5);
  assert.deepEqual(state.agents.map((entry) => entry.kind), [...LOCAL_AGENT_KINDS]);
  assert.equal(state.agents.every((entry) => !entry.registered), true);
});
