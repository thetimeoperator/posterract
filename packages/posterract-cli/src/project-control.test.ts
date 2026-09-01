import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CLI_PROTOCOL_VERSION,
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type LocalControlRequest,
  type LocalControlSession,
} from "./cli-channels";
import {
  activeProjectPointerPath,
  clearActiveProjectPointer,
  localControlPaths,
  readLocalControlSession,
  requestProjectControl,
  resolveProjectDir,
  writeActiveProjectPointer,
} from "./project-control";

async function makeProjectWithSession(
  overrides: Partial<LocalControlSession> = {},
): Promise<{ dir: string; session: LocalControlSession }> {
  const dir = await mkdtemp(join(tmpdir(), "posterract-session-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({ posterract: { schemaVersion: 1 } }));
  const now = Date.now();
  const session: LocalControlSession = {
    protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
    cliProtocolVersion: CLI_PROTOCOL_VERSION,
    desktopVersion: "0.0.0-test",
    projectId: "test-project",
    projectDir: dir,
    instanceId: "instance-1",
    capability: "cap-1",
    createdAt: now,
    expiresAt: now + 60 * 60_000,
    heartbeatAt: now,
    rendererAvailable: true,
    ...overrides,
  };
  const paths = localControlPaths(dir);
  await mkdir(paths.requests, { recursive: true });
  await mkdir(paths.responses, { recursive: true });
  await writeFile(paths.session, JSON.stringify(session));
  return { dir, session };
}

test("readLocalControlSession accepts a fresh heartbeat and a legacy session without one", async () => {
  const fresh = await makeProjectWithSession();
  try {
    assert.equal(readLocalControlSession(fresh.dir).projectId, "test-project");
  } finally {
    await rm(fresh.dir, { recursive: true, force: true });
  }

  const legacy = await makeProjectWithSession({ heartbeatAt: undefined });
  try {
    assert.equal(readLocalControlSession(legacy.dir).projectId, "test-project");
  } finally {
    await rm(legacy.dir, { recursive: true, force: true });
  }
});

test("readLocalControlSession treats a stale heartbeat as desktop-unreachable", async () => {
  const { dir } = await makeProjectWithSession({ heartbeatAt: Date.now() - 60_000 });
  try {
    assert.throws(() => readLocalControlSession(dir), /not responding|heartbeat/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requestProjectControl survives its request file being consumed before the response lands", async () => {
  const { dir } = await makeProjectWithSession();
  const paths = localControlPaths(dir);
  const desktop = (async () => {
    // A fake Desktop that consumes the request the way the fixed mailbox
    // does: delete the request file first, answer afterwards.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const names = (await readdir(paths.requests)).filter((name) => name.endsWith(".json"));
      const name = names[0];
      if (name) {
        const request = JSON.parse(await readFile(join(paths.requests, name), "utf8")) as LocalControlRequest;
        await rm(join(paths.requests, name), { force: true });
        await new Promise((resolve) => setTimeout(resolve, 50));
        const temporary = join(paths.responses, `${name}.tmp`);
        await writeFile(temporary, JSON.stringify({
          protocolVersion: LOCAL_CONTROL_PROTOCOL_VERSION,
          id: request.id,
          ok: true,
          data: { answered: request.request.path },
          completedAt: Date.now(),
        }));
        await rename(temporary, join(paths.responses, name));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The fake desktop never saw a request");
  })();
  try {
    const data = await requestProjectControl(dir, { path: "canvas.state", input: undefined }, 5_000);
    assert.deepEqual(data, { answered: "canvas.state" });
    await desktop;
    assert.deepEqual(await readdir(paths.responses), [], "the CLI cleans up its response file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install-once MCP resolves the project currently activated by Desktop", async () => {
  const root = await mkdtemp(join(tmpdir(), "posterract-active-project-"));
  const project = join(root, "project");
  const runtime = join(root, "runtime");
  const previousRuntime = process.env.POSTERRACT_RUNTIME_DIR;
  const previousProject = process.env.POSTERRACT_PROJECT_DIR;
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(project, { recursive: true }));
    await writeFile(join(project, "package.json"), JSON.stringify({ posterract: { schemaVersion: 1 } }));
    process.env.POSTERRACT_RUNTIME_DIR = runtime;
    delete process.env.POSTERRACT_PROJECT_DIR;
    writeActiveProjectPointer(project);
    assert.equal(activeProjectPointerPath(), join(runtime, "active-project.json"));
    assert.equal(resolveProjectDir(), project);
    clearActiveProjectPointer(project);
    assert.throws(() => resolveProjectDir(), /No Posterract project found/);
  } finally {
    if (previousRuntime === undefined) delete process.env.POSTERRACT_RUNTIME_DIR;
    else process.env.POSTERRACT_RUNTIME_DIR = previousRuntime;
    if (previousProject === undefined) delete process.env.POSTERRACT_PROJECT_DIR;
    else process.env.POSTERRACT_PROJECT_DIR = previousProject;
    await rm(root, { recursive: true, force: true });
  }
});
