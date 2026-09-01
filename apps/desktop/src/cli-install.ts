import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

export type CliInstallResult = {
  path: string;
  addedToPath: boolean;
  detail: string;
  version: string;
};

export type CliInspection = {
  installed: boolean;
  path: string | null;
  version: string | null;
  compatible: boolean;
  conflict: string | null;
};

function isOwnedCliLink(target: string): boolean {
  const normalized = target.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("posterract") && normalized.includes("/cli/");
}

async function replaceOwnedSymlink(target: string, source: string): Promise<void> {
  try {
    const details = await lstat(target);
    if (!details.isSymbolicLink()) {
      throw new Error(`${target} already exists and is not a Posterract-owned symlink`);
    }
    const current = await readlink(target);
    if (!isOwnedCliLink(resolve(dirname(target), current))) {
      throw new Error(`${target} points to another tool and was not changed`);
    }
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await symlink(source, target);
}

async function canWriteDirectory(path: string): Promise<boolean> {
  try {
    await mkdir(path, { recursive: true });
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function installUnix(): Promise<CliInstallResult> {
  const staged = join(app.getAppPath(), "cli", "bin", "posterract");
  await access(staged, constants.R_OK | constants.X_OK);

  const systemBin = "/usr/local/bin";
  const userBin = join(homedir(), ".local", "bin");
  let installDir = (await canWriteDirectory(systemBin)) ? systemBin : userBin;
  const systemTarget = join(systemBin, "posterract");
  try {
    await lstat(systemTarget);
    if (!(await ownsInstalledCli(systemTarget))) installDir = userBin;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(installDir, { recursive: true });
  const target = join(installDir, "posterract");

  if (process.env.APPIMAGE) {
    const wrapper = `#!/bin/sh\nexec "${process.env.APPIMAGE.replaceAll('"', '\\"')}" --posterract-cli "$@"\n`;
    try {
      const details = await lstat(target);
      if (details.isSymbolicLink() && isOwnedCliLink(resolve(dirname(target), await readlink(target)))) {
        await unlink(target);
      } else if (details.isFile()) {
        const existing = await readFile(target, "utf8");
        if (!existing.includes("--posterract-cli")) {
          throw new Error(`${target} belongs to another tool and was not changed`);
        }
      } else {
        throw new Error(`${target} belongs to another tool and was not changed`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(target, wrapper, { mode: 0o755 });
    await chmod(target, 0o755);
  } else {
    await replaceOwnedSymlink(target, staged);
  }

  const onPath = installDir === systemBin || (process.env.PATH ?? "").split(":").includes(userBin);
  return {
    path: target,
    addedToPath: onPath,
    detail: onPath
      ? "Run `posterract doctor` in a new terminal."
      : `Add ${userBin} to PATH, then run \`posterract doctor\`.`,
    version: "",
  };
}

export function runInstalledCli(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, cwd });
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (error += chunk));
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) resolveRun(output.trim());
      else rejectRun(new Error(error.trim() || `${command} exited ${code}`));
    });
  });
}

async function installWindows(): Promise<CliInstallResult> {
  const bin = join(app.getPath("userData"), "bin");
  await mkdir(bin, { recursive: true });
  const target = join(bin, "posterract.cmd");
  const executable = process.execPath.replaceAll("%", "%%");
  try {
    const existing = await readFile(target, "utf8");
    if (!existing.includes("--posterract-cli")) {
      throw new Error(`${target} belongs to another tool and was not changed`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(target, `@echo off\r\n"${executable}" --posterract-cli %*\r\n`);

  let current = "";
  try {
    current = await runInstalledCli("reg.exe", ["query", "HKCU\\Environment", "/v", "Path"]);
  } catch {
    // An absent user PATH is valid; create it below.
  }
  const value = current.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im)?.[1]?.trim() ?? "";
  const entries = value.split(";").filter(Boolean);
  if (!entries.some((entry) => entry.toLowerCase() === bin.toLowerCase())) {
    await runInstalledCli("reg.exe", [
      "add",
      "HKCU\\Environment",
      "/v",
      "Path",
      "/t",
      "REG_EXPAND_SZ",
      "/d",
      [...entries, bin].join(";"),
      "/f",
    ]);
  }
  const version = await runInstalledCli(target, ["version"]);
  return {
    path: target,
    addedToPath: true,
    detail: "Open a new terminal, then run `posterract doctor`.",
    version,
  };
}

async function ownsInstalledCli(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink()) {
      return isOwnedCliLink(resolve(dirname(path), await readlink(path)));
    }
    if (!details.isFile()) return false;
    const content = await readFile(path, "utf8");
    return content.includes("--posterract-cli") || content.includes("POSTERRACT_APP_PATH");
  } catch {
    return false;
  }
}

function installCandidates(): string[] {
  if (process.platform === "win32") return [join(app.getPath("userData"), "bin", "posterract.cmd")];
  return ["/usr/local/bin/posterract", join(homedir(), ".local", "bin", "posterract")];
}

export async function inspectCliInstallation(expectedVersion: string | null): Promise<CliInspection> {
  let conflict: string | null = null;
  for (const candidate of installCandidates()) {
    try {
      await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!(await ownsInstalledCli(candidate))) {
      conflict ??= `${candidate} exists but is not owned by Posterract`;
      continue;
    }
    try {
      const version = await runInstalledCli(candidate, ["version"]);
      return {
        installed: true,
        path: candidate,
        version,
        compatible: expectedVersion === null || version === expectedVersion,
        conflict,
      };
    } catch (error) {
      return {
        installed: true,
        path: candidate,
        version: null,
        compatible: false,
        conflict: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { installed: false, path: null, version: null, compatible: false, conflict };
}

async function installUnixVerified(): Promise<CliInstallResult> {
  const result = await installUnix();
  const version = await runInstalledCli(result.path, ["version"]);
  return { ...result, version };
}

export function installCli(): Promise<CliInstallResult> {
  return process.platform === "win32" ? installWindows() : installUnixVerified();
}
