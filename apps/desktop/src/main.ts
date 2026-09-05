import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import type { FileHandle } from "node:fs/promises";
import { MAIN_CHANNELS } from "./channels.ts";
import { handle, installMainBridge, invoke, emit } from "./ipc.ts";
import { DesktopAuthManager } from "./auth.ts";
import { isCliHeadless, startCliServer, stopCliServer } from "./cli-server.ts";
import { LocalAgentConnectionManager } from "./local-agent.ts";
import { addSkillFolder, listSkills, revealSkill } from "./skills.ts";
import {
  initializeProjectControlMailbox,
  setProjectControlMailbox,
  stopProjectControlMailbox,
} from "./project-control-mailbox.ts";
import type { LocalAgentActivity, LocalAgentKind } from "@posterract/contract/local-agent";
import {
  assetFile,
  compileProject,
  copyProjectAsset,
  createProject,
  defaultRoot,
  deleteProject,
  duplicateProject,
  ensureDefaultProject,
  getProject,
  grantExternalFile,
  initProject,
  isApprovedReadableFile,
  listEntries,
  listProjects,
  pickRoot,
  readConfig,
  readManifest,
  readProjectSource,
  realPathEntry,
  removeEntry,
  renameProject,
  resolveProject,
  restoreApprovedRoots,
  statEntry,
  unwatchAll,
  unwatchProject,
  validateProject,
  watchProject,
  writeConfig,
  writeManifest,
  writeProject,
  writeProjectAsset,
  importLottieFromUrl,
  locateProjectElement,
  readEditHistory,
  requireProjectDir,
  writeEditHistory,
  projectRevisionContent,
  projectRevisions,
  restoreProjectRevision,
  writeProjectSource,
} from "./projects.ts";
import { listTrash, putTrash, readTrash, removeTrash } from "./trash.ts";
import {
  deleteExport,
  listExports,
  recordExport,
  renameExport,
  revealExport,
} from "./exports-library.ts";
import { aiGenerate, aiKeysReveal, aiKeysSave, aiKeysStatus, transcribeLocal } from "./ai-local.ts";

const APP_SCHEME = "posterract-app";
const MEDIA_SCHEME = "posterract-media";
const DEEP_LINK_SCHEME = "posterract";
const PRIVATE_REQUEST = "posterract:desktop-request";
const PRIVATE_FILE_GRANT = "posterract:file-grant";
const LOG_LIMIT = 2_000;

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app.setName("Posterract");
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

type OpenWrite = { handle: FileHandle; path: string };
type MediaGrant = { path: string; mimeType: string; expiresAt: number };
type LogEntry = { ts: number; level: string; message: string; source: string };

const openWrites = new Map<string, OpenWrite>();
const approvedExportPaths = new Set<string>();
const completedExportPaths = new Set<string>();
const mediaGrants = new Map<string, MediaGrant>();
const logs: LogEntry[] = [];
let mainWindow: BrowserWindow | null = null;
let localAgentConnection: LocalAgentConnectionManager | null = null;
const desktopAuth = new DesktopAuthManager((state) =>
  emit(mainWindow, MAIN_CHANNELS.AUTH_STATE_CHANGED, state),
);

function pushLog(level: string, message: string, source = ""): void {
  logs.push({ ts: Date.now(), level, message, source });
  if (logs.length > LOG_LIMIT) logs.shift();
}

function requireLocalAgentConnection(): LocalAgentConnectionManager {
  if (!localAgentConnection) throw new Error("Local agent connection is not initialized");
  return localAgentConnection;
}

function rendererRoot(): string {
  return join(app.getAppPath(), "renderer");
}

function isContained(root: string, candidate: string): boolean {
  const relative = candidate.slice(root.length);
  return candidate === root || (candidate.startsWith(`${root}${sep}`) && !relative.includes(`..${sep}`));
}

function mimeType(path: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".wasm": "application/wasm",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
    }[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

function appHeaders(type: string, allowEval = false): Headers {
  return new Headers({
    "content-type": type,
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": [
      "default-src 'self' blob: data:",
      // `wasm-unsafe-eval` is what lets WebAssembly compile at all. It is the
      // narrow grant — it permits Wasm and nothing else, unlike `unsafe-eval`
      // — and CanvasKit (the Lottie renderer) does not run without it.
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${allowEval ? " 'unsafe-eval'" : ""} blob:`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      `media-src 'self' blob: data: ${MEDIA_SCHEME}: https:`,
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "frame-src 'self'",
      `connect-src 'self' ${MEDIA_SCHEME}: https://www.posterract.app https://api.posterract.app https://*.r2.cloudflarestorage.com wss:`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  });
}

async function appResponse(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const root = rendererRoot();
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const isEditorSandbox = pathname.startsWith("/editor-sandbox/");

  let file: string;
  if (isEditorSandbox) {
    const relative = pathname.slice("/editor-sandbox/".length) || "index.html";
    file = resolve(root, "editor-sandbox", normalize(relative));
  } else {
    file = resolve(root, "web", normalize(pathname.replace(/^\/+/, "")));
  }

  if (!isContained(root, file)) return new Response("Not found", { status: 404 });
  try {
    const details = await stat(file);
    if (details.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    return new Response(body, {
      status: 200,
      headers: appHeaders(mimeType(file), isEditorSandbox),
    });
  } catch {
    if (isEditorSandbox) {
      const editorIndex = join(root, "editor-sandbox", "index.html");
      return new Response(await readFile(editorIndex), {
        status: 200,
        headers: appHeaders("text/html; charset=utf-8", true),
      });
    }
    const webIndex = join(root, "web", "index.html");
    return new Response(await readFile(webIndex), {
      status: 200,
      headers: appHeaders("text/html; charset=utf-8"),
    });
  }
}

function rangeOf(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText ? Number(endText) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function mediaResponse(request: Request): Promise<Response> {
  const token = new URL(request.url).hostname;
  const grant = mediaGrants.get(token);
  if (!grant || grant.expiresAt <= Date.now()) {
    mediaGrants.delete(token);
    return new Response("Media grant expired", { status: 404 });
  }
  const details = await stat(grant.path);
  const range = rangeOf(request.headers.get("range"), details.size);
  const headers = new Headers({
    "content-type": grant.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
    "cross-origin-resource-policy": "same-origin",
  });
  if (range) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${details.size}`);
    headers.set("content-length", String(range.end - range.start + 1));
  } else {
    headers.set("content-length", String(details.size));
  }
  const stream = createReadStream(grant.path, range ? { start: range.start, end: range.end } : undefined);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  });
}

function grantMedia(path: string, type: string): string {
  const token = randomUUID();
  mediaGrants.set(token, { path, mimeType: type, expiresAt: Date.now() + 60 * 60 * 1_000 });
  return `${MEDIA_SCHEME}://${token}/${encodeURIComponent(path.split(sep).at(-1) ?? "asset")}`;
}

function validExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

async function openProjectEditor(
  dir: string,
  editor: "codex" | "claude" | "cursor" | "vscode" | "terminal",
): Promise<void> {
  const project = await getProject(dir);
  if (!project) throw new Error("Project folder is unavailable");

  // Claude Desktop documents this deep link as its supported way to open a
  // local folder in a new Claude Code session. Electron hands it to the
  // registered desktop application without exposing the folder to a shell.
  if (editor === "claude") {
    const url = new URL("claude://code/new");
    url.searchParams.set("folder", project.dir);
    await shell.openExternal(url.toString());
    return;
  }

  let command: string;
  let args: string[];
  if (process.platform === "darwin") {
    command = "/usr/bin/open";
    if (editor === "codex") {
      // The Codex desktop bundle registers itself as the handler for folders.
      // Use the bundle identifier because the installed app may be displayed
      // as either Codex or ChatGPT depending on the release channel.
      args = ["-b", "com.openai.codex", project.dir];
    } else {
      const application = editor === "cursor" ? "Cursor" : editor === "vscode" ? "Visual Studio Code" : "Terminal";
      args = ["-a", application, project.dir];
    }
  } else if (process.platform === "win32") {
    if (editor === "codex") {
      command = "cmd.exe";
      args = ["/C", "start", "", "codex://"];
    } else {
      command = editor === "cursor" ? "cursor.cmd" : editor === "vscode" ? "code.cmd" : "cmd.exe";
      args = editor === "terminal" ? ["/K", "cd", "/D", project.dir] : [project.dir];
    }
  } else {
    if (editor === "codex") {
      command = "xdg-open";
      args = ["codex://"];
    } else {
      command = editor === "cursor" ? "cursor" : editor === "vscode" ? "code" : "x-terminal-emulator";
      args = editor === "terminal" ? ["--working-directory", project.dir] : [project.dir];
    }
  }
  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
    child.once("error", rejectLaunch);
    child.once("spawn", () => {
      child.unref();
      resolveLaunch();
    });
  });
}

function captureConsole(window: BrowserWindow): void {
  window.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    pushLog(String(level), message, sourceId ? `${sourceId}:${lineNumber}` : "");
  });
  window.webContents.on("preload-error", (_event, path, error) => pushLog("error", error.message, path));
  window.webContents.on("render-process-gone", (_event, details) => {
    pushLog("error", `Renderer stopped: ${details.reason} (${details.exitCode})`);
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    title: "Posterract",
    icon: join(app.getAppPath(), "assets", "icon.png"),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#020604",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  captureConsole(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (validExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${APP_SCHEME}://`)) return;
    event.preventDefault();
    if (validExternalUrl(url)) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) window.show();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(`${APP_SCHEME}://app/`);
  mainWindow = window;
  return window;
}

function installApplicationMenu(): void {
  const installCommandLineTool = async () => {
    try {
      const state = await requireLocalAgentConnection().installOrUpdateCli();
      await dialog.showMessageBox({
        type: "info",
        title: "Posterract CLI installed",
        message: `Installed at ${state.cli.path ?? "the Posterract command path"}`,
        detail: `Version ${state.cli.version ?? "unknown"}. Run posterract doctor in a new terminal.`,
      });
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "Could not install Posterract CLI",
        message: error instanceof Error ? error.message : String(error),
        detail: "No existing command-line tool was overwritten.",
      });
    }
  };

  const downloadAgentSkill = async () => {
    try {
      await requireLocalAgentConnection().installSkill({ mode: "download" });
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "Could not save the Posterract Agent Skill",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const installItem: MenuItemConstructorOptions = {
    label: "Install Command Line Tool…",
    click: () => void installCommandLineTool(),
  };
  const skillItem: MenuItemConstructorOptions = {
    label: "Download Agent Skill…",
    click: () => void downloadAgentSkill(),
  };
  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        installItem,
        skillItem,
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }
  template.push(
    {
      label: "File",
      submenu: [
        installItem,
        skillItem,
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setFileInputFiles(
  event: IpcMainEvent | IpcMainInvokeEvent,
  selector: string,
  absolutePath: string,
): Promise<void> {
  if (!(await isApprovedReadableFile(absolutePath))) {
    throw new Error("File access was not approved by the user");
  }
  const webContents = event.sender;
  if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
  const { root } = await webContents.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`File input not found: ${selector}`);
  await webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [absolutePath], nodeId });
}

function allowedExportPath(path: string): boolean {
  const candidate = resolve(path);
  return [app.getPath("downloads"), app.getPath("videos"), app.getPath("documents")].some((root) =>
    candidate === resolve(root) || candidate.startsWith(`${resolve(root)}${sep}`),
  );
}

function registerHandlers(): void {
  installMainBridge();
  handle(MAIN_CHANNELS.APP_OPEN_EXTERNAL, ({ url }: { url: string }) => {
    if (!validExternalUrl(url)) throw new Error("Only secure external URLs may be opened");
    return shell.openExternal(url);
  });
  handle(
    MAIN_CHANNELS.APP_OPEN_PROJECT_EDITOR,
    ({ dir, editor }: { dir: string; editor: "codex" | "claude" | "cursor" | "vscode" | "terminal" }) =>
      openProjectEditor(dir, editor),
  );
  handle(MAIN_CHANNELS.APP_SHOW_IN_FOLDER, ({ path }: { path: string }) => shell.showItemInFolder(path));
  handle(MAIN_CHANNELS.AGENT_GET_STATUS, () => requireLocalAgentConnection().getStatus());
  handle(MAIN_CHANNELS.AGENT_SET_ACTIVE_PROJECT, async ({ dir }: { dir: string }) => {
    const state = await requireLocalAgentConnection().setActiveProject({ dir });
    if (state.activeProject) {
      await setProjectControlMailbox({ id: state.activeProject.id, dir: state.activeProject.dir });
    }
    return state;
  });
  handle(MAIN_CHANNELS.AGENT_SELECT, ({ agent }: { agent: LocalAgentKind }) =>
    requireLocalAgentConnection().selectAgent({ agent }),
  );
  handle(MAIN_CHANNELS.AGENT_INSTALL_CLI, () => requireLocalAgentConnection().installOrUpdateCli());
  handle(MAIN_CHANNELS.AGENT_INSTALL_MCP, (data: { agent?: unknown } = {}) =>
    requireLocalAgentConnection().registerMcp(data),
  );
  handle(
    MAIN_CHANNELS.AGENT_INSTALL_SKILL,
    ({ mode }: { mode?: "install" | "download" }) => requireLocalAgentConnection().installSkill({ mode }),
  );
  handle(MAIN_CHANNELS.AGENT_LAUNCH, (data: { agent?: unknown } = {}) =>
    requireLocalAgentConnection().launchSelectedAgent(data),
  );
  handle(MAIN_CHANNELS.AGENT_TEST_CONNECTION, () => requireLocalAgentConnection().testConnection());
  handle(MAIN_CHANNELS.AGENT_RECORD_ACTIVITY, (activity: LocalAgentActivity) =>
    requireLocalAgentConnection().recordActivity(activity),
  );
  handle(MAIN_CHANNELS.AGENT_RESET, () => requireLocalAgentConnection().reset());
  handle(MAIN_CHANNELS.AUTH_GET_STATE, () => desktopAuth.getState());
  handle(MAIN_CHANNELS.AUTH_SIGN_IN, () => desktopAuth.signIn());
  handle(MAIN_CHANNELS.AUTH_SIGN_OUT, () => desktopAuth.signOut());
  handle(MAIN_CHANNELS.CLOUD_REQUEST, (request: Parameters<typeof desktopAuth.cloudRequest>[0]) =>
    desktopAuth.cloudRequest(request),
  );
  handle(
    MAIN_CHANNELS.CLOUD_UPLOAD_FILE,
    async (
      { path, contentType, durationMs, width, height, projectId, sceneId, sourceRevision }: {
        path: string;
        contentType: string;
        durationMs?: number;
        width?: number;
        height?: number;
        projectId?: string | null;
        sceneId?: string | null;
        sourceRevision?: string | null;
      },
    ) => {
      const resolvedPath = resolve(path);
      const completedExport = completedExportPaths.has(resolvedPath);
      const selectedInput = await isApprovedReadableFile(resolvedPath);
      if (!completedExport && !selectedInput) {
        throw new Error("Only a completed export or a video selected by the user can be uploaded");
      }
      if (!completedExport && !new Set([".mp4", ".mov", ".webm"]).has(extname(resolvedPath).toLowerCase())) {
        throw new Error("Select an MP4, MOV, or WebM video");
      }
      return desktopAuth.uploadFile(path, { contentType, durationMs, width, height, projectId, sceneId, sourceRevision }, (progress) =>
        emit(mainWindow, MAIN_CHANNELS.CLOUD_UPLOAD_PROGRESS, { path, progress }),
      );
    },
  );
  handle(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, () => null);
  handle(MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK, () => null);
  handle(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false);
  handle(MAIN_CHANNELS.WINDOW_CAPTURE, async (_data, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Window is unavailable");
    const image = await window.webContents.capturePage();
    const size = image.getSize();
    return { base64: image.toPNG().toString("base64"), width: size.width, height: size.height };
  });
  handle(MAIN_CHANNELS.HEADLESS_GET_MODE, () => isCliHeadless());
  handle(MAIN_CHANNELS.LOGS_GET, () => logs);
  handle(MAIN_CHANNELS.PROJECTS_PICK_ROOT, (_data, event) => pickRoot(BrowserWindow.fromWebContents(event.sender)));
  handle(MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT, () => defaultRoot());
  handle(MAIN_CHANNELS.PROJECTS_LIST, ({ root }: { root: string }) => listProjects(root));
  handle(MAIN_CHANNELS.PROJECTS_GET, ({ dir }: { dir: string }) => getProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_INIT, ({ dir }: { dir: string }) => initProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_RESOLVE, ({ root, ref }: { root: string; ref: string }) => resolveProject(root, ref));
  handle(MAIN_CHANNELS.PROJECTS_CREATE, ({ root, displayName }: { root: string; displayName: string }) =>
    createProject(root, displayName),
  );
  handle(MAIN_CHANNELS.PROJECTS_ENSURE_DEFAULT, () => ensureDefaultProject());
  handle(MAIN_CHANNELS.PROJECTS_RENAME, ({ dir, displayName }: { dir: string; displayName: string }) =>
    renameProject(dir, displayName),
  );
  handle(MAIN_CHANNELS.PROJECTS_DUPLICATE, ({ dir }: { dir: string }) => duplicateProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_DELETE, ({ dir }: { dir: string }) => deleteProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_COMPILE, ({ dir }: { dir: string }) => compileProject(dir));
  // Bring-your-own-keys AI generation: keys live in the project's
  // api-keys.json, providers are called from this process, outputs land in
  // the project's assets/generated. Nothing leaves the user's machine but
  // the provider requests themselves.
  handle(MAIN_CHANNELS.AI_KEYS_STATUS, (data: Parameters<typeof aiKeysStatus>[0]) => aiKeysStatus(data));
  handle(MAIN_CHANNELS.AI_KEYS_SAVE, (data: Parameters<typeof aiKeysSave>[0]) => aiKeysSave(data));
  handle(MAIN_CHANNELS.AI_KEYS_REVEAL, (data: Parameters<typeof aiKeysReveal>[0]) => aiKeysReveal(data));
  handle(MAIN_CHANNELS.AI_GENERATE, (data: Parameters<typeof aiGenerate>[0]) => aiGenerate(data));
  handle(MAIN_CHANNELS.AI_TRANSCRIBE, (data: { dir: string; path: string }) => transcribeLocal(data));
  // Read-only sibling of PROJECTS_COMPILE for the agent bridge's `validate`:
  // same compile (stamping included), but in memory — never writes to disk.
  handle(MAIN_CHANNELS.PROJECTS_VALIDATE, ({ dir }: { dir: string }) => validateProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_WRITE, ({ dir, edits }: { dir: string; edits: Parameters<typeof writeProject>[1] }) =>
    writeProject(dir, edits),
  );
  handle(MAIN_CHANNELS.PROJECTS_WATCH, ({ dir }: { dir: string }, event) =>
    watchProject(BrowserWindow.fromWebContents(event.sender), dir),
  );
  handle(MAIN_CHANNELS.PROJECTS_UNWATCH, ({ dir }: { dir: string }) => unwatchProject(dir));
  handle(MAIN_CHANNELS.PROJECTS_MANIFEST_READ, ({ dir }: { dir: string }) => readManifest(dir));
  handle(MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE, ({ dir, manifest }: { dir: string; manifest: unknown }) =>
    writeManifest(dir, manifest),
  );
  handle(MAIN_CHANNELS.PROJECTS_CONFIG_READ, ({ dir }: { dir: string }) => readConfig(dir));
  handle(MAIN_CHANNELS.PROJECTS_CONFIG_WRITE, ({ dir, config }: { dir: string; config: unknown }) =>
    writeConfig(dir, config),
  );
  handle(MAIN_CHANNELS.PROJECTS_SOURCE_READ, ({ dir, path }: { dir: string; path: string }) =>
    readProjectSource(dir, path),
  );
  handle(MAIN_CHANNELS.PROJECTS_SOURCE_WRITE, (data: Parameters<typeof writeProjectSource>[0]) =>
    writeProjectSource(data),
  );
  handle(MAIN_CHANNELS.PROJECTS_REVISIONS_LIST, ({ dir, path }: { dir: string; path: string }) =>
    projectRevisions(dir, path),
  );
  handle(MAIN_CHANNELS.PROJECTS_REVISIONS_READ, ({ dir, path, id }: { dir: string; path: string; id: string }) =>
    projectRevisionContent(dir, path, id),
  );
  handle(MAIN_CHANNELS.PROJECTS_REVISIONS_RESTORE, ({ dir, path, id }: { dir: string; path: string; id: string }) =>
    restoreProjectRevision(dir, path, id),
  );
  handle(
    MAIN_CHANNELS.PROJECTS_TRASH_PUT,
    async ({ dir, sceneId, name }: { dir: string; sceneId: string; name: string }) => {
      const projectDir = await requireProjectDir(dir);
      const project = await getProject(projectDir);
      if (!project) throw new Error("Project not found");
      return putTrash(projectDir, { sceneId, name, entryPath: project.entry });
    },
  );
  handle(MAIN_CHANNELS.PROJECTS_TRASH_LIST, async ({ dir }: { dir: string }) =>
    listTrash(await requireProjectDir(dir)),
  );
  // Skill folders: the content types a scene can be made as (see skills.ts).
  handle(MAIN_CHANNELS.SKILLS_LIST, async ({ dir }: { dir: string | null }) =>
    listSkills(dir ? await requireProjectDir(dir) : null),
  );
  handle(MAIN_CHANNELS.SKILLS_ADD_FOLDER, async () => addSkillFolder());
  handle(MAIN_CHANNELS.SKILLS_REVEAL, async ({ path }: { path: string }) => {
    revealSkill(path);
  });
  handle(MAIN_CHANNELS.PROJECTS_TRASH_READ, async ({ dir, id }: { dir: string; id: string }) =>
    readTrash(await requireProjectDir(dir), id),
  );
  handle(MAIN_CHANNELS.PROJECTS_TRASH_REMOVE, async ({ dir, id }: { dir: string; id: string }) =>
    removeTrash(await requireProjectDir(dir), id),
  );
  handle(MAIN_CHANNELS.PROJECTS_HISTORY_READ, ({ dir }: { dir: string }) => readEditHistory(dir));
  handle(MAIN_CHANNELS.PROJECTS_HISTORY_WRITE, ({ dir, value }: { dir: string; value: unknown }) =>
    writeEditHistory(dir, value),
  );
  handle(MAIN_CHANNELS.EXPORTS_RECORD, (entry: Parameters<typeof recordExport>[0]) => recordExport(entry));
  handle(MAIN_CHANNELS.EXPORTS_LIST, () => listExports());
  handle(MAIN_CHANNELS.EXPORTS_REVEAL, ({ id }: { id: string }) => revealExport(id));
  handle(MAIN_CHANNELS.EXPORTS_DELETE, ({ id, removeFile }: { id: string; removeFile?: boolean }) =>
    deleteExport(id, removeFile === true),
  );
  handle(MAIN_CHANNELS.EXPORTS_RENAME, ({ id, name }: { id: string; name: string }) => renameExport(id, name));
  handle(MAIN_CHANNELS.PROJECTS_SOURCE_LOCATE, async ({ dir, id }: { dir: string; id: string }) => {
    const at = await locateProjectElement(dir, id);
    if (!at) return null;
    // Open the file itself rather than a line-addressed URL: the user's
    // default handler for .tsx is whatever they chose, and only some of them
    // understand a line fragment.
    await shell.openPath(join(await requireProjectDir(dir), at.path));
    return at;
  });
  handle(MAIN_CHANNELS.PROJECTS_FS_LIST, ({ dir, source }: { dir: string; source: string }) => listEntries(dir, source));
  handle(MAIN_CHANNELS.PROJECTS_FS_STAT, ({ dir, source }: { dir: string; source: string }) => statEntry(dir, source));
  handle(MAIN_CHANNELS.PROJECTS_FS_FILE, async ({ dir, source }: { dir: string; source: string }) => {
    const file = await assetFile(dir, source);
    return { name: file.name, mimeType: file.mimeType, mtime: file.mtime, url: grantMedia(file.path, file.mimeType) };
  });
  handle(MAIN_CHANNELS.PROJECTS_FS_WRITE, ({ dir, path, bytes }: { dir: string; path: string; bytes: Uint8Array }) => {
    if (!(bytes instanceof Uint8Array)) throw new Error("Project asset bytes are missing");
    return writeProjectAsset(dir, path, bytes);
  });
  handle(
    MAIN_CHANNELS.PROJECTS_FS_COPY,
    ({ dir, source, path }: { dir: string; source: string; path: string }) => copyProjectAsset(dir, source, path),
  );
  handle(MAIN_CHANNELS.PROJECTS_FS_REMOVE, ({ dir, path }: { dir: string; path: string }) => removeEntry(dir, path));
  handle(MAIN_CHANNELS.PROJECTS_FS_REAL_PATH, ({ dir, source }: { dir: string; source: string }) => realPathEntry(dir, source));
  handle(
    MAIN_CHANNELS.PROJECTS_IMPORT_LOTTIE_URL,
    ({ dir, url, name }: { dir: string; url: string; name?: string }) => importLottieFromUrl(dir, url, name),
  );
  handle(MAIN_CHANNELS.FILE_TRANSFER, ({ selector, absolutePath }: { selector: string; absolutePath: string }, event) =>
    setFileInputFiles(event, selector, absolutePath),
  );
  handle(
    MAIN_CHANNELS.FILE_PICK_EXPORT,
    async ({ suggestedName, extension, description }: { suggestedName: string; extension: string; description: string }, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: "Export from Posterract",
        defaultPath: join(app.getPath("videos"), suggestedName),
        filters: [{ name: description, extensions: [extension.replace(/^\./, "")] }],
        properties: ["showOverwriteConfirmation", "createDirectory"] as Array<"showOverwriteConfirmation" | "createDirectory">,
      };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      if (!allowedExportPath(result.filePath)) {
        throw new Error("Choose Downloads, Videos, or Documents for this export");
      }
      approvedExportPaths.add(resolve(result.filePath));
      return { path: result.filePath };
    },
  );
  handle(
    MAIN_CHANNELS.FILE_AUTHORIZE_CLI_EXPORT,
    async ({ projectDir, path }: { projectDir: string; path: string }) => {
      const project = await getProject(projectDir);
      if (!project) throw new Error("The CLI export project is unavailable");
      const candidate = resolve(path);
      const exportsRoot = resolve(project.dir, "exports");
      const insideProjectExports = candidate === exportsRoot || candidate.startsWith(`${exportsRoot}${sep}`);
      if (!insideProjectExports && !allowedExportPath(candidate)) {
        throw new Error("CLI exports must be inside the project's exports folder, Downloads, Videos, or Documents");
      }
      if (!new Set([".mp4", ".webm", ".ogg", ".mov"]).has(extname(candidate).toLowerCase())) {
        throw new Error("CLI export output must end in .mp4, .webm, .ogg, or .mov");
      }
      await mkdir(dirname(candidate), { recursive: true });
      approvedExportPaths.add(candidate);
      return { path: candidate };
    },
  );
  handle(
    MAIN_CHANNELS.FILE_AUTHORIZE_CLI_MEDIA,
    async ({ path, format }: { path: string; format: "mp4" | "ogg" }) => {
      const candidate = resolve(path);
      const expected = format === "mp4" ? ".mp4" : ".ogg";
      if (extname(candidate).toLowerCase() !== expected) {
        throw new Error(`Extracted ${format.toUpperCase()} output must end in ${expected}`);
      }
      if (!allowedExportPath(candidate)) {
        throw new Error("Extracted media must be written to Downloads, Videos, or Documents");
      }
      await mkdir(dirname(candidate), { recursive: true });
      approvedExportPaths.add(candidate);
      return { path: candidate };
    },
  );
  handle(MAIN_CHANNELS.FILE_WRITE_OPEN, async ({ path, exclusive }: { path: string; exclusive?: boolean }) => {
    const resolvedPath = resolve(path);
    // Approval is the whole gate. Each way into `approvedExportPaths` applies
    // its own policy — the save dialog is the user's own choice, and the CLI
    // handlers check the destination before adding it. Re-applying the
    // narrower Downloads/Videos/Documents rule here rejected a project's own
    // `exports/` folder whenever the project lived anywhere else, which is
    // most of them.
    if (!approvedExportPaths.has(resolvedPath)) {
      throw new Error("Export path was not approved through the save dialog");
    }
    approvedExportPaths.delete(resolvedPath);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, exclusive ? "wx" : "w");
    const id = randomUUID();
    openWrites.set(id, { handle: file, path });
    return { id };
  });
  handle(MAIN_CHANNELS.FILE_WRITE_CHUNK, async ({ id, data, position }: { id: string; data: Uint8Array; position: number }) => {
    const entry = openWrites.get(id);
    if (!entry) throw new Error("Export stream is closed");
    const bytes = Buffer.from(data);
    await entry.handle.write(bytes, 0, bytes.byteLength, position);
  });
  handle(MAIN_CHANNELS.FILE_WRITE_CLOSE, async ({ id }: { id: string }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    await entry.handle.close();
    approvedExportPaths.delete(resolve(entry.path));
    completedExportPaths.add(resolve(entry.path));
  });
  handle(MAIN_CHANNELS.FILE_WRITE_ABORT, async ({ id }: { id: string }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    await entry.handle.close().catch(() => undefined);
    await unlink(entry.path).catch(() => undefined);
    approvedExportPaths.delete(resolve(entry.path));
    completedExportPaths.delete(resolve(entry.path));
  });
}

ipcMain.handle(PRIVATE_REQUEST, (event, channel: string, data: unknown) => invoke(channel as never, data, event));
ipcMain.on(PRIVATE_FILE_GRANT, (_event, path: unknown) => {
  if (typeof path === "string" && isAbsolute(path)) grantExternalFile(path);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    protocol.handle(APP_SCHEME, appResponse);
    protocol.handle(MEDIA_SCHEME, mediaResponse);
    await restoreApprovedRoots();
    localAgentConnection = new LocalAgentConnectionManager({
      emitStatus: (state) => emit(mainWindow, MAIN_CHANNELS.AGENT_CONNECTION_CHANGED, state),
      launchAgent: (dir, agent) => openProjectEditor(dir, agent),
    });
    await localAgentConnection.initialize();
    registerHandlers();
    await desktopAuth.initialize();
    initializeProjectControlMailbox(() => mainWindow);
    startCliServer(() => mainWindow);
    installApplicationMenu();

    app.on("web-contents-created", (_event, contents) => {
      contents.on("will-attach-webview", (event) => event.preventDefault());
    });
    app.on("browser-window-created", (_event, window) => {
      window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(permission === "fullscreen" || permission === "clipboard-sanitized-write");
      });
      window.webContents.session.setPermissionCheckHandler((_contents, permission) =>
        permission === "fullscreen" || permission === "clipboard-sanitized-write",
      );
    });

    if (process.platform === "darwin") {
      const icon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon.png"));
      if (!icon.isEmpty()) app.dock?.setIcon(icon);
    }
    createWindow();
  });

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
  app.on("before-quit", () => {
    stopCliServer();
    void stopProjectControlMailbox();
    unwatchAll();
    for (const entry of openWrites.values()) void entry.handle.close().catch(() => undefined);
    openWrites.clear();
    approvedExportPaths.clear();
    completedExportPaths.clear();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
