/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { transformAsync, type TransformOptions } from "@babel/core";
import presetTypescript from "@babel/preset-typescript";
import presetSolid from "babel-preset-solid";
import { build, type Plugin } from "esbuild";
import { posix } from "node:path";
import { canonicalizeTagsPlugin, inspectPlugin, sourcePlugin } from "./source.ts";

export type VirtualSourceFile = {
  path: string;
  content: string;
};

export type CompileDiagnostic = {
  file?: string;
  line?: number;
  column?: number;
  severity: "error" | "warning";
  message: string;
};

export type CompileResult =
  | { ok: true; code: string; diagnostics: CompileDiagnostic[] }
  | { ok: false; diagnostics: CompileDiagnostic[] };

const RUNTIME_MODULE = "@posterract/composition";
const SCRIPT_EXTENSIONS = /\.[cm]?[jt]sx?$/;

function normalizePath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Invalid virtual project path: ${path}`);
  }
  return normalized;
}

function babelOptions(file: string): TransformOptions {
  return {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceMaps: "inline",
    plugins: [[sourcePlugin, { file }], canonicalizeTagsPlugin, [inspectPlugin, { file }]],
    presets: [
      [presetSolid, { generate: "universal", moduleName: RUNTIME_MODULE }],
      [presetTypescript, { onlyRemoveTypeImports: true }],
    ],
  };
}

function virtualProjectPlugin(files: Map<string, string>): Plugin {
  return {
    name: "posterract-virtual-project",
    setup(context) {
      context.onResolve({ filter: /.*/ }, (args) => {
        if (["solid-js", "solid-js/store", RUNTIME_MODULE].includes(args.path)) {
          return { path: args.path, external: true };
        }

        const base = args.importer ? args.importer.slice(0, args.importer.lastIndexOf("/") + 1) : "";
        const candidate = normalizePath(`${base}${args.path}`);
        const variants = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}.jsx`];
        const resolved = variants.find((path) => files.has(path));
        if (!resolved) return { errors: [{ text: `Import not found in project: ${args.path}` }] };
        return { path: resolved, namespace: "posterract-project" };
      });

      context.onLoad({ filter: /.*/, namespace: "posterract-project" }, async (args) => {
        const source = files.get(args.path);
        if (source === undefined) return { errors: [{ text: `Missing virtual file: ${args.path}` }] };
        if (!SCRIPT_EXTENSIONS.test(args.path)) return { contents: source, loader: args.path.endsWith(".json") ? "json" : "text" };
        const transformed = await transformAsync(source, babelOptions(args.path));
        return { contents: transformed?.code ?? "", loader: "js" };
      });
    },
  };
}

function diagnosticsFrom(error: unknown): CompileDiagnostic[] {
  const detail = error as {
    errors?: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } }>;
    message?: string;
  };
  if (detail.errors?.length) {
    return detail.errors.map((entry) => ({
      file: entry.location?.file,
      line: entry.location?.line,
      column: entry.location?.column,
      severity: "error",
      message: entry.text ?? "Compilation failed",
    }));
  }
  return [{ severity: "error", message: detail.message ?? String(error) }];
}

export async function compileVirtualProject(
  sourceFiles: VirtualSourceFile[],
  entryPath = "index.tsx",
): Promise<CompileResult> {
  const files = new Map(sourceFiles.map((file) => [normalizePath(file.path), file.content]));
  const entry = normalizePath(entryPath);
  if (!files.has(entry)) {
    return { ok: false, diagnostics: [{ file: entry, severity: "error", message: "Project entry file is missing" }] };
  }

  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      write: false,
      sourcemap: "inline",
      plugins: [virtualProjectPlugin(files)],
      logLevel: "silent",
    });
    return { ok: true, code: result.outputFiles[0]?.text ?? "", diagnostics: [] };
  } catch (error) {
    return { ok: false, diagnostics: diagnosticsFrom(error) };
  }
}
