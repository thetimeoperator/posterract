"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/project-control.test.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_promises = require("node:fs/promises");
var import_node_os3 = require("node:os");
var import_node_path3 = require("node:path");
var import_node_test = __toESM(require("node:test"));

// src/cli-channels.ts
var CLI_PROTOCOL_VERSION = 2;
var LOCAL_CONTROL_PROTOCOL_VERSION = 1;
var LOCAL_CONTROL_RUNTIME = {
  dir: ".posterract/runtime",
  session: "session.json",
  requests: "requests",
  responses: "responses",
  captures: "captures"
};

// src/project-control.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path2 = require("node:path");

// src/cli-socket-path.ts
var import_node_crypto = require("node:crypto");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var SOCKET_PATH = (0, import_node_os.platform)() === "win32" ? `\\\\.\\pipe\\posterract-editor-${(0, import_node_crypto.createHash)("sha256").update((0, import_node_os.homedir)()).digest("hex").slice(0, 12)}` : (0, import_node_path.join)((0, import_node_os.tmpdir)(), `posterract-editor-${typeof process.getuid === "function" ? process.getuid() : "user"}.sock`);

// src/project-control.ts
var POLL_MS = 35;
var ACTIVE_PROJECT_POINTER_VERSION = 1;
var HEARTBEAT_STALE_MS = 45e3;
function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
function readJson(path) {
  return JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
}
function looksLikeProject(dir) {
  try {
    const pkg = readJson((0, import_node_path2.join)(dir, "package.json"));
    return pkg.posterract !== void 0;
  } catch {
    return false;
  }
}
function activeProjectPointerPath() {
  const runtime = process.env.POSTERRACT_RUNTIME_DIR;
  return runtime ? (0, import_node_path2.join)((0, import_node_path2.resolve)(runtime), "active-project.json") : (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".posterract", "runtime", "active-project.json");
}
function readActiveProjectPointer() {
  try {
    const value = readJson(activeProjectPointerPath());
    if (value.version !== ACTIVE_PROJECT_POINTER_VERSION || typeof value.projectDir !== "string" || !looksLikeProject((0, import_node_path2.resolve)(value.projectDir))) {
      return null;
    }
    return (0, import_node_path2.resolve)(value.projectDir);
  } catch {
    return null;
  }
}
function writeActiveProjectPointer(projectDir) {
  const normalized = (0, import_node_path2.resolve)(projectDir);
  if (!looksLikeProject(normalized)) throw new Error("Cannot activate a folder that is not a Posterract project.");
  const target = activeProjectPointerPath();
  const temporary = `${target}.${process.pid}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
  (0, import_node_fs.mkdirSync)((0, import_node_path2.dirname)(target), { recursive: true, mode: 448 });
  (0, import_node_fs.writeFileSync)(
    temporary,
    `${JSON.stringify({ version: ACTIVE_PROJECT_POINTER_VERSION, projectDir: normalized, updatedAt: Date.now() })}
`,
    { mode: 384 }
  );
  (0, import_node_fs.renameSync)(temporary, target);
}
function clearActiveProjectPointer(projectDir) {
  if (projectDir) {
    const current = readActiveProjectPointer();
    if (!current || current !== (0, import_node_path2.resolve)(projectDir)) return;
  }
  (0, import_node_fs.rmSync)(activeProjectPointerPath(), { force: true });
}
function resolveProjectDir(explicit) {
  const candidates = [
    explicit,
    process.env.POSTERRACT_PROJECT_DIR,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.VSCODE_CWD,
    readActiveProjectPointer(),
    process.cwd()
  ].filter((value) => Boolean(value));
  for (const candidate of candidates) {
    let current = (0, import_node_path2.resolve)(candidate);
    const root = (0, import_node_path2.parse)(current).root;
    while (true) {
      if (looksLikeProject(current)) return current;
      if (current === root) break;
      current = (0, import_node_path2.dirname)(current);
    }
  }
  throw new Error("No Posterract project found. Open a project in Posterract Desktop and launch the agent from that folder.");
}
function localControlPaths(projectDir) {
  const runtime = (0, import_node_path2.join)(projectDir, LOCAL_CONTROL_RUNTIME.dir);
  return {
    runtime,
    session: (0, import_node_path2.join)(runtime, LOCAL_CONTROL_RUNTIME.session),
    requests: (0, import_node_path2.join)(runtime, LOCAL_CONTROL_RUNTIME.requests),
    responses: (0, import_node_path2.join)(runtime, LOCAL_CONTROL_RUNTIME.responses),
    captures: (0, import_node_path2.join)(runtime, LOCAL_CONTROL_RUNTIME.captures)
  };
}
function readLocalControlSession(projectDir) {
  const { session } = localControlPaths(projectDir);
  if (!(0, import_node_fs.existsSync)(session)) {
    throw new Error("Posterract Desktop is not exposing this project. Open the project in Desktop and retry.");
  }
  const value = readJson(session);
  if (value.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION) {
    throw new Error(
      `Desktop local-control protocol ${value.protocolVersion} is incompatible with ${LOCAL_CONTROL_PROTOCOL_VERSION}. Update Posterract Desktop.`
    );
  }
  if (value.cliProtocolVersion !== CLI_PROTOCOL_VERSION) {
    throw new Error(
      `Desktop CLI protocol ${value.cliProtocolVersion} is incompatible with ${CLI_PROTOCOL_VERSION}. Update the Posterract tools.`
    );
  }
  if ((0, import_node_path2.resolve)(value.projectDir) !== (0, import_node_path2.resolve)(projectDir)) {
    throw new Error("The local-control session belongs to a different project.");
  }
  if (value.expiresAt <= Date.now()) {
    throw new Error("The Posterract project session expired. Reopen the project in Desktop.");
  }
  if (typeof value.heartbeatAt === "number" && Date.now() - value.heartbeatAt > HEARTBEAT_STALE_MS) {
    throw new Error(
      "Posterract Desktop is not responding: its project session heartbeat is stale. Start Posterract Desktop and open this project, then retry."
    );
  }
  if (!value.rendererAvailable) {
    throw new Error("The Posterract canvas renderer is not available yet.");
  }
  return value;
}
async function requestProjectControl(projectDir, request, timeoutMs, activity) {
  const paths = localControlPaths(projectDir);
  const session = readLocalControlSession(projectDir);
  (0, import_node_fs.mkdirSync)(paths.requests, { recursive: true, mode: 448 });
  (0, import_node_fs.mkdirSync)(paths.responses, { recursive: true, mode: 448 });
  const id = (0, import_node_crypto2.randomUUID)();
  const requestPath = (0, import_node_path2.join)(paths.requests, `${id}.json`);
  const temporary = `${requestPath}.${process.pid}.tmp`;
  const responsePath = (0, import_node_path2.join)(paths.responses, `${id}.json`);
  const deadline = Date.now() + timeoutMs;
  const envelope = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    id,
    instanceId: session.instanceId,
    capability: session.capability,
    projectDir,
    deadline,
    request,
    activity
  };
  (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(envelope)}
`, { mode: 384 });
  (0, import_node_fs.renameSync)(temporary, requestPath);
  try {
    while (Date.now() <= deadline) {
      let raw = null;
      try {
        raw = (0, import_node_fs.readFileSync)(responsePath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (raw !== null) {
        const response = JSON.parse(raw);
        if (response.protocolVersion !== LOCAL_CONTROL_PROTOCOL_VERSION || response.id !== id) {
          throw new Error("Posterract Desktop returned an invalid local-control response.");
        }
        if (response.ok) return response.data;
        throw new Error(response.error);
      }
      await sleep(POLL_MS);
    }
    throw new Error(`Timed out waiting for Posterract Desktop to answer ${request.path}.`);
  } finally {
    (0, import_node_fs.rmSync)(requestPath, { force: true });
    (0, import_node_fs.rmSync)(responsePath, { force: true });
  }
}

// src/project-control.test.ts
async function makeProjectWithSession(overrides = {}) {
  const dir = await (0, import_promises.mkdtemp)((0, import_node_path3.join)((0, import_node_os3.tmpdir)(), "posterract-session-"));
  await (0, import_promises.writeFile)((0, import_node_path3.join)(dir, "package.json"), JSON.stringify({ posterract: { schemaVersion: 1 } }));
  const now = Date.now();
  const session = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    cliProtocolVersion: CLI_PROTOCOL_VERSION,
    desktopVersion: "0.0.0-test",
    projectId: "test-project",
    projectDir: dir,
    instanceId: "instance-1",
    capability: "cap-1",
    createdAt: now,
    expiresAt: now + 60 * 6e4,
    heartbeatAt: now,
    rendererAvailable: true,
    ...overrides
  };
  const paths = localControlPaths(dir);
  await (0, import_promises.mkdir)(paths.requests, { recursive: true });
  await (0, import_promises.mkdir)(paths.responses, { recursive: true });
  await (0, import_promises.writeFile)(paths.session, JSON.stringify(session));
  return { dir, session };
}
(0, import_node_test.default)("readLocalControlSession accepts a fresh heartbeat and a legacy session without one", async () => {
  const fresh = await makeProjectWithSession();
  try {
    import_strict.default.equal(readLocalControlSession(fresh.dir).projectId, "test-project");
  } finally {
    await (0, import_promises.rm)(fresh.dir, { recursive: true, force: true });
  }
  const legacy = await makeProjectWithSession({ heartbeatAt: void 0 });
  try {
    import_strict.default.equal(readLocalControlSession(legacy.dir).projectId, "test-project");
  } finally {
    await (0, import_promises.rm)(legacy.dir, { recursive: true, force: true });
  }
});
(0, import_node_test.default)("readLocalControlSession treats a stale heartbeat as desktop-unreachable", async () => {
  const { dir } = await makeProjectWithSession({ heartbeatAt: Date.now() - 6e4 });
  try {
    import_strict.default.throws(() => readLocalControlSession(dir), /not responding|heartbeat/i);
  } finally {
    await (0, import_promises.rm)(dir, { recursive: true, force: true });
  }
});
(0, import_node_test.default)("requestProjectControl survives its request file being consumed before the response lands", async () => {
  const { dir } = await makeProjectWithSession();
  const paths = localControlPaths(dir);
  const desktop = (async () => {
    const deadline = Date.now() + 5e3;
    while (Date.now() < deadline) {
      const names = (await (0, import_promises.readdir)(paths.requests)).filter((name2) => name2.endsWith(".json"));
      const name = names[0];
      if (name) {
        const request = JSON.parse(await (0, import_promises.readFile)((0, import_node_path3.join)(paths.requests, name), "utf8"));
        await (0, import_promises.rm)((0, import_node_path3.join)(paths.requests, name), { force: true });
        await new Promise((resolve2) => setTimeout(resolve2, 50));
        const temporary = (0, import_node_path3.join)(paths.responses, `${name}.tmp`);
        await (0, import_promises.writeFile)(temporary, JSON.stringify({
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          id: request.id,
          ok: true,
          data: { answered: request.request.path },
          completedAt: Date.now()
        }));
        await (0, import_promises.rename)(temporary, (0, import_node_path3.join)(paths.responses, name));
        return;
      }
      await new Promise((resolve2) => setTimeout(resolve2, 10));
    }
    throw new Error("The fake desktop never saw a request");
  })();
  try {
    const data = await requestProjectControl(dir, { path: "canvas.state", input: void 0 }, 5e3);
    import_strict.default.deepEqual(data, { answered: "canvas.state" });
    await desktop;
    import_strict.default.deepEqual(await (0, import_promises.readdir)(paths.responses), [], "the CLI cleans up its response file");
  } finally {
    await (0, import_promises.rm)(dir, { recursive: true, force: true });
  }
});
(0, import_node_test.default)("install-once MCP resolves the project currently activated by Desktop", async () => {
  const root = await (0, import_promises.mkdtemp)((0, import_node_path3.join)((0, import_node_os3.tmpdir)(), "posterract-active-project-"));
  const project = (0, import_node_path3.join)(root, "project");
  const runtime = (0, import_node_path3.join)(root, "runtime");
  const previousRuntime = process.env.POSTERRACT_RUNTIME_DIR;
  const previousProject = process.env.POSTERRACT_PROJECT_DIR;
  try {
    await import("node:fs/promises").then(({ mkdir: mkdir2 }) => mkdir2(project, { recursive: true }));
    await (0, import_promises.writeFile)((0, import_node_path3.join)(project, "package.json"), JSON.stringify({ posterract: { schemaVersion: 1 } }));
    process.env.POSTERRACT_RUNTIME_DIR = runtime;
    delete process.env.POSTERRACT_PROJECT_DIR;
    writeActiveProjectPointer(project);
    import_strict.default.equal(activeProjectPointerPath(), (0, import_node_path3.join)(runtime, "active-project.json"));
    import_strict.default.equal(resolveProjectDir(), project);
    clearActiveProjectPointer(project);
    import_strict.default.throws(() => resolveProjectDir(), /No Posterract project found/);
  } finally {
    if (previousRuntime === void 0) delete process.env.POSTERRACT_RUNTIME_DIR;
    else process.env.POSTERRACT_RUNTIME_DIR = previousRuntime;
    if (previousProject === void 0) delete process.env.POSTERRACT_PROJECT_DIR;
    else process.env.POSTERRACT_PROJECT_DIR = previousProject;
    await (0, import_promises.rm)(root, { recursive: true, force: true });
  }
});
