import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activeProjectPointerPath,
  clearActiveProjectPointer,
  resolveProjectDir,
  writeActiveProjectPointer,
} from "./project-control";

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
