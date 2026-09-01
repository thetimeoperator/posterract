import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { app, dialog, shell } from "electron";
import { unzipSync } from "fflate";
import {
  LOCAL_AGENT_KINDS,
  LOCAL_AGENT_LABELS,
  LOCAL_AGENT_LAUNCH_WINDOW_MS,
  deriveLocalAgentBridgeState,
  isLocalAgentKind,
  type LocalAgentActivity,
  type LocalAgentConnectionState,
  type LocalAgentKind,
} from "@posterract/contract/local-agent";
import { CLI_PROTOCOL_VERSION } from "@posterract/cli/channels";
import { clearActiveProjectPointer, writeActiveProjectPointer } from "@posterract/cli/project-control";
import { getProject, type ProjectInfo } from "./projects.ts";
import { inspectCliInstallation, installCli, type CliInspection } from "./cli-install.ts";
import { upsertMcpJson } from "./mcp-client-config.ts";

type StoredPreferences = {
  version: 1;
  selectedAgent: LocalAgentKind;
  lastProjectDir: string | null;
  lastSeenAt: number | null;
  lastCommand: string | null;
  verifiedAt: number | null;
  cliVersion: string | null;
  skillVersion: string | null;
  mcpClient?: LocalAgentKind | null;
  /** Every client Posterract has registered itself with, in any project. */
  registeredAgents?: LocalAgentKind[];
  mcpProjectDir?: string | null;
  mcpConfiguredAt?: number | null;
  mcpVerifiedAt?: number | null;
  mcpToolCount?: number | null;
};

type SkillManifest = {
  version: string;
  fileName: string;
  sha256?: string;
};

type CliManifest = {
  version: string;
  protocolVersion: number;
};

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type LocalAgentConnectionManagerDeps = {
  emitStatus: (state: LocalAgentConnectionState) => void;
  launchAgent: (dir: string, agent: LocalAgentKind) => Promise<void>;
};

const STORE_FILE = "local-agent-connection.json";
const MANAGED_SKILL_MARKER = ".posterract-managed.json";
const MAX_ACTIVITY_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Where each client's executable is normally found. A client we cannot locate
 * is reported as not installed rather than registered against a bare name that
 * would fail on the first call.
 */
const AGENT_COMMANDS: Record<"codex" | "claude" | "code", string[]> =
  process.platform === "darwin"
    ? {
        codex: [
          "/Applications/Codex.app/Contents/Resources/codex",
          "/Applications/ChatGPT.app/Contents/Resources/codex",
          "/opt/homebrew/bin/codex",
          "/usr/local/bin/codex",
          join(homedir(), ".local", "bin", "codex"),
        ],
        claude: [
          join(homedir(), ".local", "bin", "claude"),
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
        ],
        code: [
          "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
          "/opt/homebrew/bin/code",
          "/usr/local/bin/code",
        ],
      }
    : process.platform === "win32"
      ? { codex: ["codex.exe"], claude: ["claude.exe"], code: ["code.cmd"] }
      : { codex: ["codex"], claude: ["claude"], code: ["code"] };

/** The client's executable, or null when it is not on this machine. */
function findAgentCommand(name: "codex" | "claude" | "code"): string | null {
  const candidates = AGENT_COMMANDS[name];
  const located = candidates.find((candidate) => candidate.includes("/") && existsSync(candidate));
  if (located) return located;
  // A bare name on a platform we do not probe by path is resolved by the OS.
  return candidates.length === 1 && !candidates[0]!.includes("/") ? candidates[0]! : null;
}

function agentCommand(name: "codex" | "claude" | "code"): string {
  const located = findAgentCommand(name);
  if (!located) throw new Error(`${name} was not found on this computer.`);
  return located;
}

/**
 * Cursor has no CLI we drive; Posterract writes its config file directly, so
 * its presence is judged by the application or its config folder. A generic
 * agent is always available because setup is a file the user copies.
 */
function isAgentInstalled(kind: LocalAgentKind): boolean {
  switch (kind) {
    case "codex": return findAgentCommand("codex") !== null;
    case "claude": return findAgentCommand("claude") !== null;
    case "vscode": return findAgentCommand("code") !== null;
    case "cursor":
      return existsSync(join(homedir(), ".cursor")) || existsSync("/Applications/Cursor.app");
    case "terminal": return true;
  }
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseJsonObject(text: string): Record<string, unknown> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]!) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    } catch {
      // Commands may write progress before the final JSON object.
    }
  }
  throw new Error("The Posterract CLI did not return valid JSON");
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 120_000,
  stdinText?: string,
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectCommand(new Error(`posterract ${args[0] ?? "command"} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    if (stdinText !== undefined) child.stdin.end(stdinText);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveCommand({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function mcpSmokeInput(): string {
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "posterract-desktop-check", version: "1" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "posterract_connection_status", arguments: {} },
    },
  ];
  return `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`;
}

function parseMcpSmoke(stdout: string): { toolCount: number } {
  const replies = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const listed = replies.find((reply) => reply.id === 2)?.result as { tools?: unknown[] } | undefined;
  const called = replies.find((reply) => reply.id === 3)?.result as { isError?: boolean } | undefined;
  if (!listed?.tools?.length) throw new Error("The Posterract MCP server exposed no tools");
  if (!called || called.isError) throw new Error("The Posterract MCP server could not reach the live canvas");
  return { toolCount: listed.tools.length };
}

export class LocalAgentConnectionManager {
  private selectedAgent: LocalAgentKind = "codex";
  private activeProject: ProjectInfo | null = null;
  private lastSeenAt: number | null = null;
  private lastCommand: string | null = null;
  private verifiedAt: number | null = null;
  private launchedAt: number | null = null;
  private error: string | null = null;
  private cli: CliInspection = {
    installed: false,
    path: null,
    version: null,
    compatible: false,
    conflict: null,
  };
  private cliManifest: CliManifest | null = null;
  private skillManifest: SkillManifest | null = null;
  private integrationError: string | null = null;
  private testing = false;
  private mcpClient: LocalAgentKind | null = null;
  private registeredAgents = new Set<LocalAgentKind>();
  private mcpProjectDir: string | null = null;
  private mcpConfiguredAt: number | null = null;
  private mcpVerifiedAt: number | null = null;
  private mcpToolCount: number | null = null;
  private mcpError: string | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: LocalAgentConnectionManagerDeps) {}

  private storePath(): string {
    return join(app.getPath("userData"), STORE_FILE);
  }

  private skillStagePath(): string {
    return join(app.getAppPath(), "skill");
  }

  private codexSkillPath(): string {
    return join(homedir(), ".codex", "skills", "posterract");
  }

  private async readBundledMetadata(): Promise<void> {
    try {
      this.cliManifest = JSON.parse(
        await readFile(join(app.getAppPath(), "cli", "manifest.json"), "utf8"),
      ) as CliManifest;
    } catch {
      this.cliManifest = null;
    }
    try {
      this.skillManifest = JSON.parse(
        await readFile(join(this.skillStagePath(), "manifest.json"), "utf8"),
      ) as SkillManifest;
    } catch {
      this.skillManifest = null;
    }
  }

  private async readPreferences(): Promise<StoredPreferences | null> {
    try {
      const stored = JSON.parse(await readFile(this.storePath(), "utf8")) as Partial<StoredPreferences>;
      if (stored.version !== 1 || !isLocalAgentKind(stored.selectedAgent)) return null;
      return {
        version: 1,
        selectedAgent: stored.selectedAgent,
        lastProjectDir: typeof stored.lastProjectDir === "string" ? stored.lastProjectDir : null,
        lastSeenAt: typeof stored.lastSeenAt === "number" ? stored.lastSeenAt : null,
        lastCommand: typeof stored.lastCommand === "string" ? stored.lastCommand : null,
        verifiedAt: typeof stored.verifiedAt === "number" ? stored.verifiedAt : null,
        cliVersion: typeof stored.cliVersion === "string" ? stored.cliVersion : null,
        skillVersion: typeof stored.skillVersion === "string" ? stored.skillVersion : null,
        mcpClient: isLocalAgentKind(stored.mcpClient) ? stored.mcpClient : null,
        registeredAgents: Array.isArray(stored.registeredAgents)
          ? stored.registeredAgents.filter(isLocalAgentKind)
          : [],
        mcpProjectDir: typeof stored.mcpProjectDir === "string" ? stored.mcpProjectDir : null,
        mcpConfiguredAt: typeof stored.mcpConfiguredAt === "number" ? stored.mcpConfiguredAt : null,
        mcpVerifiedAt: typeof stored.mcpVerifiedAt === "number" ? stored.mcpVerifiedAt : null,
        mcpToolCount: typeof stored.mcpToolCount === "number" ? stored.mcpToolCount : null,
      };
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    const target = this.storePath();
    const temporary = `${target}.${randomUUID()}.tmp`;
    const value: StoredPreferences = {
      version: 1,
      selectedAgent: this.selectedAgent,
      lastProjectDir: this.activeProject?.dir ?? null,
      lastSeenAt: this.lastSeenAt,
      lastCommand: this.lastCommand,
      verifiedAt: this.verifiedAt,
      cliVersion: this.cli.version,
      skillVersion: this.skillManifest?.version ?? null,
      mcpClient: this.mcpClient,
      registeredAgents: [...this.registeredAgents],
      mcpProjectDir: this.mcpProjectDir,
      mcpConfiguredAt: this.mcpConfiguredAt,
      mcpVerifiedAt: this.mcpVerifiedAt,
      mcpToolCount: this.mcpToolCount,
    };
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  }

  async initialize(): Promise<void> {
    await this.readBundledMetadata();
    const stored = await this.readPreferences();
    if (stored) {
      this.selectedAgent = stored.selectedAgent;
      this.lastSeenAt = stored.lastSeenAt;
      this.lastCommand = stored.lastCommand;
      this.verifiedAt = stored.verifiedAt;
      this.mcpClient = stored.mcpClient ?? null;
      this.registeredAgents = new Set(stored.registeredAgents ?? []);
      // A client registered before this field existed is still registered.
      if (!this.registeredAgents.size && stored.mcpClient) this.registeredAgents.add(stored.mcpClient);
      this.mcpProjectDir = stored.mcpProjectDir ?? null;
      this.mcpConfiguredAt = stored.mcpConfiguredAt ?? null;
      this.mcpVerifiedAt = stored.mcpVerifiedAt ?? null;
      this.mcpToolCount = stored.mcpToolCount ?? null;
      if (stored.lastProjectDir) {
        this.activeProject = await getProject(stored.lastProjectDir).catch(() => null);
        if (this.activeProject) writeActiveProjectPointer(this.activeProject.dir);
      }
    }
    await this.refreshCli();
    this.scheduleIdleTransition();
  }

  private async refreshCli(): Promise<void> {
    this.cli = await inspectCliInstallation(this.cliManifest?.version ?? null);
    if (this.cliManifest && this.cliManifest.protocolVersion !== CLI_PROTOCOL_VERSION) {
      this.cli.compatible = false;
    }
  }

  private async projectGuidance(): Promise<LocalAgentConnectionState["guidance"]> {
    const skillVersion = this.skillManifest?.version ?? null;
    let installed = false;
    try {
      const installedManifest = JSON.parse(
        await readFile(join(this.codexSkillPath(), "manifest.json"), "utf8"),
      ) as { name?: string; version?: string };
      installed = installedManifest.name === "posterract" && installedManifest.version === skillVersion;
    } catch {
      installed = false;
    }

    let projectInstructionsPresent = false;
    if (this.activeProject) {
      projectInstructionsPresent =
        (await fileExists(join(this.activeProject.dir, "AGENTS.md"))) &&
        (await fileExists(join(this.activeProject.dir, ".posterract", "docs", "module-contract.md"))) &&
        (await fileExists(
          join(
            this.activeProject.dir,
            ".posterract",
            "sdk",
            "node_modules",
            "@posterract",
            "composition",
            "dist",
            "index.d.ts",
          ),
        ));
    }

    return {
      projectInstructionsPresent,
      skillAvailable: Boolean(
        this.skillManifest && existsSync(join(this.skillStagePath(), this.skillManifest.fileName)),
      ),
      skillVersion,
      installed,
    };
  }

  private scheduleIdleTransition(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const deadlines = [
      this.lastSeenAt ? this.lastSeenAt + 60_100 : null,
      this.verifiedAt ? this.verifiedAt + 60_100 : null,
      this.launchedAt ? this.launchedAt + LOCAL_AGENT_LAUNCH_WINDOW_MS + 100 : null,
    ].filter((value): value is number => value !== null && value > Date.now());
    if (!deadlines.length) return;
    const delay = Math.max(250, Math.min(...deadlines) - Date.now());
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.broadcast();
    }, delay);
  }

  async getStatus(refresh = true): Promise<LocalAgentConnectionState> {
    if (refresh) {
      await this.refreshCli();
    }
    const guidance = await this.projectGuidance();
    const integrationConfigured = Boolean(
      this.mcpConfiguredAt &&
      this.mcpClient === this.selectedAgent &&
      this.activeProject &&
      (this.selectedAgent !== "terminal" || (
        this.mcpProjectDir && resolve(this.mcpProjectDir) === resolve(this.activeProject.dir)
      ))
    );
    const base: LocalAgentConnectionState = {
      environment: "desktop",
      // Every supported client, each with what a click on it would have to do.
      // Registration is global, so `registered` does not vary by project.
      agents: LOCAL_AGENT_KINDS.map((kind) => ({
        kind,
        label: LOCAL_AGENT_LABELS[kind],
        installed: isAgentInstalled(kind),
        registered: this.registeredAgents.has(kind),
      })),
      selectedAgent: this.selectedAgent,
      activeProject: this.activeProject
        ? {
            id: this.activeProject.id,
            name: this.activeProject.displayName,
            dir: this.activeProject.dir,
          }
        : null,
      cli: {
        installed: this.cli.installed,
        path: this.cli.path,
        version: this.cli.version,
        compatible: this.cli.compatible,
      },
      integration: {
        // Every supported client is registered the same way: a stdio MCP
        // entry naming the Posterract command. Only a generic agent has to
        // import it by hand.
        method: this.selectedAgent === "terminal" ? "manual" : "mcp_config",
        installed: integrationConfigured,
        version: this.cli.version,
        client: this.selectedAgent,
        error: this.integrationError,
      },
      mcp: {
        available: Boolean(this.cliManifest),
        configured: integrationConfigured,
        client: this.selectedAgent,
        projectDir: this.mcpProjectDir,
        serverVersion: this.cliManifest?.version ?? null,
        toolCount: this.mcpToolCount,
        verifiedAt: this.mcpVerifiedAt,
        error: this.mcpError,
      },
      guidance,
      bridge: {
        state: "setup_required",
        lastSeenAt: this.lastSeenAt,
        lastCommand: this.lastCommand,
        error: this.error ?? this.cli.conflict,
      },
    };
    base.bridge.state = deriveLocalAgentBridgeState(base, {
      verifiedAt: this.verifiedAt,
      launchedAt: this.launchedAt,
      error: base.bridge.error,
    });
    return base;
  }

  private async broadcast(): Promise<LocalAgentConnectionState> {
    const state = await this.getStatus(false);
    this.deps.emitStatus(state);
    return state;
  }

  async setActiveProject(input: { dir: string }): Promise<LocalAgentConnectionState> {
    const project = await getProject(input.dir);
    if (!project) throw new Error("The selected Posterract project is unavailable");
    const changed = this.activeProject?.dir !== project.dir;
    this.activeProject = project;
    writeActiveProjectPointer(project.dir);
    if (changed) {
      this.verifiedAt = null;
      this.launchedAt = null;
      this.error = null;
      this.mcpVerifiedAt = null;
      this.mcpError = null;
    }
    await this.persist();
    return this.broadcast();
  }

  async selectAgent(input: { agent: unknown }): Promise<LocalAgentConnectionState> {
    if (!isLocalAgentKind(input.agent)) throw new Error("Unsupported local agent");
    this.selectedAgent = input.agent;
    this.launchedAt = null;
    this.error = null;
    this.mcpVerifiedAt = null;
    this.mcpError = null;
    this.integrationError = null;
    await this.persist();
    return this.broadcast();
  }

  async installOrUpdateCli(): Promise<LocalAgentConnectionState> {
    try {
      const installed = await installCli();
      await this.refreshCli();
      if (!this.cli.installed || !this.cli.compatible || this.cli.version !== installed.version) {
        throw new Error("The installed CLI could not be verified against this desktop build");
      }
      this.error = null;
      this.verifiedAt = null;
      await this.persist();
      return this.broadcast();
    } catch (error) {
      this.error = errorMessage(error);
      await this.broadcast();
      throw error;
    }
  }

  private async saveSkillDownload(): Promise<{ path: string } | null> {
    if (!this.skillManifest) throw new Error("The bundled Posterract skill is unavailable");
    const result = await dialog.showSaveDialog({
      title: "Save Posterract Agent Skill",
      defaultPath: join(app.getPath("downloads"), this.skillManifest.fileName),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });
    if (result.canceled || !result.filePath) return null;
    const source = join(this.skillStagePath(), this.skillManifest.fileName);
    const bytes = await readFile(source);
    await writeFile(result.filePath, bytes);
    await writeFile(`${result.filePath}.sha256`, await readFile(`${source}.sha256`));
    shell.showItemInFolder(result.filePath);
    return { path: result.filePath };
  }

  private async installCodexSkill(): Promise<{ path: string }> {
    if (!this.skillManifest) throw new Error("The bundled Posterract skill is unavailable");
    const destination = this.codexSkillPath();
    if (await fileExists(destination)) {
      if (!(await fileExists(join(destination, MANAGED_SKILL_MARKER)))) {
        throw new Error(
          "A Posterract skill already exists but is not desktop-managed. Save the skill ZIP and update it manually.",
        );
      }
    }

    const archive = await readFile(join(this.skillStagePath(), this.skillManifest.fileName));
    const files = unzipSync(new Uint8Array(archive));
    const temporary = `${destination}.install-${randomUUID()}`;
    const backup = `${destination}.backup-${randomUUID()}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    for (const [archivePath, bytes] of Object.entries(files)) {
      const relativePath = archivePath.replace(/^posterract-skill\//, "");
      if (!relativePath || relativePath.endsWith("/")) continue;
      const output = resolve(temporary, relativePath);
      if (output !== temporary && !output.startsWith(`${temporary}${sep}`)) {
        throw new Error("The bundled skill contains an unsafe path");
      }
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, bytes);
    }
    await writeFile(
      join(temporary, MANAGED_SKILL_MARKER),
      `${JSON.stringify({ version: this.skillManifest.version, installedAt: Date.now() }, null, 2)}\n`,
      { mode: 0o600 },
    );

    let movedExisting = false;
    try {
      if (await fileExists(destination)) {
        await rename(destination, backup);
        movedExisting = true;
      } else {
        await mkdir(dirname(destination), { recursive: true });
      }
      await rename(temporary, destination);
      if (movedExisting) await rm(backup, { recursive: true, force: true });
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (movedExisting && !(await fileExists(destination))) await rename(backup, destination);
      throw error;
    }
    return { path: destination };
  }

  async installSkill(input: { mode?: "install" | "download" }): Promise<LocalAgentConnectionState> {
    try {
      if ((input.mode ?? (this.selectedAgent === "codex" ? "install" : "download")) === "install") {
        await this.installCodexSkill();
      } else {
        await this.saveSkillDownload();
      }
      this.error = null;
      await this.persist();
      return this.broadcast();
    } catch (error) {
      this.error = errorMessage(error);
      await this.broadcast();
      throw error;
    }
  }

  /**
   * Register the packaged stdio server with the selected agent. The server
   * command is the verified Posterract-owned CLI. Codex, Claude, Cursor, and
   * VS Code are registered once at user scope; the MCP resolves whichever
   * project Posterract Desktop currently exposes. No credential or prompt is
   * written into a client configuration.
   */
  async registerMcp(input: { agent?: unknown } = {}): Promise<LocalAgentConnectionState> {
    const agent = input.agent === undefined ? this.selectedAgent : input.agent;
    if (!isLocalAgentKind(agent)) throw new Error("Unsupported local agent");
    if (!isAgentInstalled(agent)) {
      throw new Error(`${LOCAL_AGENT_LABELS[agent]} was not found on this computer. Install it first.`);
    }
    if (!this.activeProject) throw new Error("Open a Posterract project before connecting MCP");
    await this.refreshCli();
    if (!this.cli.path || !this.cli.installed || !this.cli.compatible) {
      throw new Error("Install the matching Posterract CLI before connecting MCP");
    }

    const projectDir = this.activeProject.dir;
    const cliPath = this.cli.path;
    try {
      switch (agent) {
        case "codex": {
          // Codex owns its TOML format and migration rules, so use its own
          // management command rather than rewriting the user's config file.
          await runCommand(agentCommand("codex"), ["mcp", "remove", "posterract"], projectDir, 30_000).catch(() => null);
          const result = await runCommand(
            agentCommand("codex"),
            ["mcp", "add", "posterract", "--", cliPath, "mcp", "serve"],
            projectDir,
            30_000,
          );
          if (result.code !== 0) {
            throw new Error(result.stderr || result.stdout || "Codex rejected the Posterract MCP installation");
          }
          break;
        }
        case "claude":
          await runCommand(agentCommand("claude"), ["mcp", "remove", "posterract", "--scope", "user"], projectDir, 30_000).catch(() => null);
          {
            const result = await runCommand(
              agentCommand("claude"),
              ["mcp", "add", "--scope", "user", "posterract", "--", cliPath, "mcp", "serve"],
              projectDir,
              30_000,
            );
            if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Claude Code rejected the Posterract MCP installation");
          }
          break;
        case "cursor":
          await upsertMcpJson(join(homedir(), ".cursor", "mcp.json"), "mcpServers", cliPath);
          break;
        case "vscode": {
          const definition = JSON.stringify({ name: "posterract", command: cliPath, args: ["mcp", "serve"] });
          const result = await runCommand(agentCommand("code"), ["--add-mcp", definition], projectDir, 30_000);
          if (result.code !== 0) throw new Error(result.stderr || result.stdout || "VS Code rejected the Posterract MCP installation");
          break;
        }
        case "terminal":
          // Generic local agents can import this standard MCP configuration.
          // It is kept out of client-specific directories and remains local.
          await upsertMcpJson(join(projectDir, ".posterract", "mcp.json"), "mcpServers", cliPath);
          break;
      }

      this.registeredAgents.add(agent);
      this.selectedAgent = agent;
      this.mcpClient = agent;
      this.mcpProjectDir = agent === "terminal" ? projectDir : null;
      this.mcpConfiguredAt = Date.now();
      this.mcpVerifiedAt = null;
      this.mcpToolCount = null;
      this.mcpError = null;
      this.integrationError = null;
      this.error = null;
      await this.persist();
      return this.broadcast();
    } catch (error) {
      this.mcpError = errorMessage(error);
      this.integrationError = this.mcpError;
      this.error = this.mcpError;
      await this.persist();
      await this.broadcast();
      throw error;
    }
  }

  /**
   * Open this project in one client. A single click is the whole flow: the
   * command is installed if missing, the client registered if this is its
   * first use, then the project is opened in it.
   */
  async launchSelectedAgent(input: { agent?: unknown } = {}): Promise<LocalAgentConnectionState> {
    const agent = input.agent === undefined ? this.selectedAgent : input.agent;
    if (!isLocalAgentKind(agent)) throw new Error("Unsupported local agent");
    if (!isAgentInstalled(agent)) {
      throw new Error(`${LOCAL_AGENT_LABELS[agent]} was not found on this computer. Install it first.`);
    }
    this.selectedAgent = agent;
    if (!this.activeProject) throw new Error("Open a Posterract project before launching an agent");
    let status = await this.getStatus();
    if (!status.cli.installed || !status.cli.compatible) {
      await this.installOrUpdateCli();
      status = await this.getStatus();
    }
    if (!status.guidance.projectInstructionsPresent) {
      throw new Error("This project is missing its Posterract agent guidance. Reopen or repair the project first.");
    }
    if (!this.registeredAgents.has(agent) || !status.cli.installed) {
      await this.registerMcp({ agent });
    }
    await this.deps.launchAgent(this.activeProject.dir, agent);
    this.launchedAt = Date.now();
    this.error = null;
    await this.persist();
    this.scheduleIdleTransition();
    return this.broadcast();
  }

  private recoveryFromDoctor(doctor: Record<string, unknown>): string {
    const checks = Array.isArray(doctor.checks) ? doctor.checks : [];
    const failed = checks.find((check) => {
      if (!check || typeof check !== "object") return false;
      return (check as { ok?: unknown }).ok === false;
    }) as { recovery?: unknown; detail?: unknown } | undefined;
    if (typeof failed?.recovery === "string") return failed.recovery;
    if (typeof failed?.detail === "string") return failed.detail;
    return "Run `posterract doctor --json` for the failed check.";
  }

  async testConnection(): Promise<LocalAgentConnectionState> {
    await this.refreshCli();
    if (!this.activeProject) throw new Error("Open a Posterract project before testing the connection");
    if (!this.cli.path || !this.cli.installed) throw new Error("Install the Posterract CLI before testing");
    if (!this.cli.compatible) throw new Error("Update the Posterract CLI before testing");

    this.testing = true;
    try {
      const opened = await runCommand(
        this.cli.path,
        ["open", this.activeProject.dir, "--background"],
        this.activeProject.dir,
      );
      if (opened.code !== 0) throw new Error(opened.stderr || opened.stdout || "The project could not be opened");

      const doctorResult = await runCommand(
        this.cli.path,
        ["doctor", "--json"],
        this.activeProject.dir,
      );
      const doctor = parseJsonObject(doctorResult.stdout);
      if (doctorResult.code !== 0 || doctor.ok !== true) {
        throw new Error(this.recoveryFromDoctor(doctor));
      }

      const contextResult = await runCommand(
        this.cli.path,
        ["context", "--json"],
        this.activeProject.dir,
      );
      if (contextResult.code !== 0) {
        throw new Error(contextResult.stderr || contextResult.stdout || "Context check failed");
      }
      const context = parseJsonObject(contextResult.stdout);
      if (typeof context.projectDir !== "string" || resolve(context.projectDir) !== resolve(this.activeProject.dir)) {
        throw new Error("Posterract Desktop opened a different project. Reopen the selected project and retry.");
      }
      if (context.compileState !== "ready") {
        throw new Error("The active project compiler is not ready");
      }

      const mcpResult = await runCommand(
        this.cli.path,
        ["mcp", "serve", "--project", this.activeProject.dir],
        this.activeProject.dir,
        120_000,
        mcpSmokeInput(),
      );
      if (mcpResult.code !== 0) {
        throw new Error(mcpResult.stderr || "The Posterract MCP server failed its connection check");
      }
      const mcp = parseMcpSmoke(mcpResult.stdout);

      this.error = null;
      this.verifiedAt = Date.now();
      this.mcpVerifiedAt = this.verifiedAt;
      this.mcpToolCount = mcp.toolCount;
      this.mcpError = null;
      this.launchedAt = null;
      await this.persist();
      this.scheduleIdleTransition();
      return this.broadcast();
    } catch (error) {
      this.error = errorMessage(error);
      this.mcpError = this.error;
      this.verifiedAt = null;
      this.mcpVerifiedAt = null;
      await this.persist();
      await this.broadcast();
      throw error;
    } finally {
      this.testing = false;
    }
  }

  async recordActivity(activity: LocalAgentActivity): Promise<void> {
    if (this.testing) return;
    if (
      !activity ||
      typeof activity.command !== "string" ||
      !/^[a-z][a-z0-9:-]{0,63}$/i.test(activity.command) ||
      typeof activity.cliVersion !== "string" ||
      typeof activity.projectDir !== "string" ||
      typeof activity.invokedAt !== "number" ||
      Math.abs(Date.now() - activity.invokedAt) > MAX_ACTIVITY_CLOCK_SKEW_MS
    ) {
      return;
    }
    if (this.cliManifest?.version && activity.cliVersion !== this.cliManifest.version) return;
    if (this.activeProject && resolve(activity.projectDir) !== resolve(this.activeProject.dir)) return;
    this.lastSeenAt = Date.now();
    this.lastCommand = activity.command;
    this.launchedAt = null;
    this.error = null;
    await this.persist();
    this.scheduleIdleTransition();
    await this.broadcast();
  }

  async reset(): Promise<LocalAgentConnectionState> {
    const previousProjectDir = this.activeProject?.dir;
    this.selectedAgent = "codex";
    this.activeProject = null;
    this.lastSeenAt = null;
    this.lastCommand = null;
    this.verifiedAt = null;
    this.launchedAt = null;
    this.error = null;
    this.mcpClient = null;
    this.registeredAgents.clear();
    this.mcpProjectDir = null;
    this.mcpConfiguredAt = null;
    this.mcpVerifiedAt = null;
    this.mcpToolCount = null;
    this.mcpError = null;
    this.integrationError = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    clearActiveProjectPointer(previousProjectDir);
    await this.persist();
    return this.broadcast();
  }
}
