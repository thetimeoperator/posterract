#!/usr/bin/env node
// A local stand-in for an OpenAI-compatible transcription endpoint (Groq), so
// the voice bar can be tested end to end without a real key or a real call.
//
//   POST /audio/transcriptions   multipart, as the app sends it; answers { text }
//                                with whatever was set as the next text
//   POST /next                   { "text": "split" } — what the next clip "says"
//   GET  /last                   the last request's fields, the file's size,
//                                and how many requests have come in
//
// Point a scratch project's api-keys.json at it with a dummy key:
//   { "transcribe": "stub", "transcribeUrl": "http://127.0.0.1:<port>" }
//
//   node scripts/stub-transcribe.mjs [port]      (0 or nothing: any free port)

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 0);
let nextText = "split";
let last = null;
let count = 0;

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const reply = (status, payload) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  };

  try {
    if (request.method === "POST" && url.pathname === "/audio/transcriptions") {
      const raw = await body(request);
      const form = await new Request("http://stub/", {
        method: "POST",
        headers: { "content-type": request.headers["content-type"] ?? "" },
        body: raw,
      }).formData();
      const fields = {};
      let file = null;
      for (const [name, value] of form.entries()) {
        if (typeof value === "string") fields[name] = value;
        else file = { name: value.name, type: value.type, bytes: value.size };
      }
      count += 1;
      last = {
        fields,
        file,
        authorization: request.headers.authorization ? "present" : "missing",
        at: Date.now(),
      };
      reply(200, { text: nextText });
      return;
    }
    if (request.method === "POST" && url.pathname === "/next") {
      nextText = String(JSON.parse((await body(request)).toString("utf8") || "{}").text ?? "");
      reply(200, { ok: true, next: nextText });
      return;
    }
    if (request.method === "GET" && url.pathname === "/last") {
      reply(200, { last, count });
      return;
    }
    reply(404, { error: { message: "Not here" } });
  } catch (error) {
    reply(500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`stub-transcribe listening on http://127.0.0.1:${address.port}\n`);
});
