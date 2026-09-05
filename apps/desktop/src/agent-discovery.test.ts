import assert from "node:assert/strict";
import test from "node:test";
import { resolveCommand } from "./local-agent";

const posixAbsolute = (path: string) => path.startsWith("/");
const windowsAbsolute = (path: string) => /^[A-Za-z]:[\\/]/.test(path);
const plain = (name: string) => [name];
const windowsVariants = (name: string) => [name, `${name}.exe`, `${name}.cmd`];

test("a bare name that is nowhere on the search path is not installed", () => {
  // The whole bug: Windows and Linux offered a single bare candidate, which was
  // returned without ever touching the disk, so every agent read as installed.
  const found = resolveCommand(["claude"], ["/usr/bin", "/usr/local/bin"], plain, () => false, posixAbsolute);
  assert.equal(found, null);
});

test("a bare name is found in a directory the session PATH omits", () => {
  // A desktop-launched Linux app does not inherit the login shell's PATH, so
  // ~/.local/bin has to be searched explicitly or a real install looks missing.
  //
  // resolveCommand joins with the host separator, so this case is asserted on
  // separator-independent form — the rule is what is under test, not join().
  const posix = (path: string) => path.replace(/\\/g, "/");
  const found = resolveCommand(
    ["claude"],
    ["/usr/bin", "/home/sina/.local/bin"],
    plain,
    (path) => posix(path) === "/home/sina/.local/bin/claude",
    posixAbsolute,
  );
  assert.equal(found && posix(found), "/home/sina/.local/bin/claude");
});

test("an absolute candidate wins over a search, and a missing one is skipped", () => {
  const found = resolveCommand(
    ["/Applications/Codex.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "codex"],
    ["/usr/bin"],
    plain,
    (path) => path === "/opt/homebrew/bin/codex",
    posixAbsolute,
  );
  assert.equal(found, "/opt/homebrew/bin/codex");
});

test("Windows resolves through PATHEXT rather than the bare name", () => {
  // `code` on Windows is code.cmd. Probing only the bare name finds nothing.
  const found = resolveCommand(
    ["code"],
    ["C:\\Users\\sina\\AppData\\Roaming\\npm"],
    windowsVariants,
    (path) => path.endsWith("code.cmd"),
    windowsAbsolute,
  );
  assert.ok(found?.endsWith("code.cmd"), `expected a .cmd, got ${found}`);
});

test("a Windows absolute path is recognised as absolute", () => {
  // The old check was candidate.includes("/"), which no Windows path satisfies,
  // so every absolute Windows candidate fell through unexamined.
  const found = resolveCommand(
    ["C:\\Program Files\\Codex\\codex.exe"],
    [],
    windowsVariants,
    (path) => path === "C:\\Program Files\\Codex\\codex.exe",
    windowsAbsolute,
  );
  assert.equal(found, "C:\\Program Files\\Codex\\codex.exe");
});
