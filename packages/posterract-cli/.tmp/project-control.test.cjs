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
var ACTIVE_PROJECT_POINTER_VERSION = 1;
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

// src/project-control.test.ts
(0, import_node_test.default)("install-once MCP resolves the project currently activated by Desktop", async () => {
  const root = await (0, import_promises.mkdtemp)((0, import_node_path3.join)((0, import_node_os3.tmpdir)(), "posterract-active-project-"));
  const project = (0, import_node_path3.join)(root, "project");
  const runtime = (0, import_node_path3.join)(root, "runtime");
  const previousRuntime = process.env.POSTERRACT_RUNTIME_DIR;
  const previousProject = process.env.POSTERRACT_PROJECT_DIR;
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(project, { recursive: true }));
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
