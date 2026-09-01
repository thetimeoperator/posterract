import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { applyEdits, compileVirtualProject, stampProject } from "@posterract/video-compiler";

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

/** Local-only compiler bridge. Production uses the authenticated Posterract API. */
function creativeCompilerDevPlugin(): Plugin {
  return {
    name: "posterract-creative-compiler-dev",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "POST" || !request.url?.startsWith("/__posterract/creative/")) return next();
        try {
          const body = (await readBody(request)) as {
            files?: Record<string, string>;
            operations?: unknown[];
            entryPath?: string;
          };
          const files = { ...(body.files ?? {}) };
          if (request.url === "/__posterract/creative/operations") {
            const writeResult = await applyEdits(
              { files },
              (body.operations ?? []) as Parameters<typeof applyEdits>[1],
            );
            const compilation = await compileVirtualProject(
              Object.entries(files).map(([path, content]) => ({ path, content })),
              body.entryPath ?? "index.tsx",
            );
            return sendJson(response, compilation.ok ? 200 : 422, { files, writeResult, compilation });
          }
          await stampProject({ files });
          const compilation = await compileVirtualProject(
            Object.entries(files).map(([path, content]) => ({ path, content })),
            body.entryPath ?? "index.tsx",
          );
          return sendJson(response, compilation.ok ? 200 : 422, { files, compilation });
        } catch (error) {
          return sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    creativeCompilerDevPlugin(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
