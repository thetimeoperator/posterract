#!/usr/bin/env node
// A local stand-in for OpenRouter's decisions endpoint (Jev), so the voice
// bar's own-words reading can be tested end to end without a real key or a
// real call. It answers in the shape the real one does (checked against it
// on 2026-09-19 — choice answers with probabilities and confidence, noul
// answers with a probability, score answers with an index and a legend):
//
//   POST …/decisions   { model, state, questions } → { model, answers, usage, provider }
//                      Each question is answered from the script for
//                      state.command when there is one; anything unscripted
//                      is a firm no ("none", "unstated", or noul 0.02).
//   POST /script       { command, answers, delayMs? } — how the next requests
//                      about `command` are answered; answers are partial
//                      ({ choice, confidence, probabilities } / { noul } / { score })
//   GET  /last         the last request (model, state, question types), how
//                      many came in, and how many the caller gave up on
//   POST /reset        forgets scripts and counts
//
// Point a scratch project's api-keys.json at it with a dummy key:
//   { "openrouter": "stub", "decisionsUrl": "http://127.0.0.1:<port>/api/alpha/decisions" }
//
//   node scripts/stub-decisions.mjs [port]      (0 or nothing: any free port)

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 0);
let scripts = new Map();
let last = null;
let count = 0;
let aborted = 0;
let history = [];

const normalize = (text) => String(text ?? "").toLowerCase().trim().replace(/\s+/g, " ");

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The answer to one question: scripted, or a firm no. */
function answer(id, question, scripted) {
  const given = scripted?.[id];
  if (question.type === "noul") return { type: "noul", noul: typeof given?.noul === "number" ? given.noul : 0.02 };
  if (question.type === "score") {
    // As the real endpoint answers: the level's index, and a legend naming each index.
    const levels = Array.isArray(question.criteria) ? question.criteria : [];
    const legend = Object.fromEntries(levels.map((level, index) => [String(index), level]));
    return { type: "score", score: given?.score ?? 1, legend, confidence: given?.confidence ?? 0.9 };
  }
  const options = Object.keys(question.criteria ?? {});
  const fallback = options.includes("none") ? "none" : options.includes("unstated") ? "unstated" : options[0];
  const choice = given?.choice ?? fallback;
  const confidence = given?.confidence ?? 0.9;
  return {
    type: "choice",
    choice,
    probabilities: given?.probabilities ?? { [choice]: confidence },
    confidence,
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const reply = (status, payload) => {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  };

  try {
    if (request.method === "POST" && url.pathname.endsWith("/decisions")) {
      const raw = await body(request);
      const payload = JSON.parse(raw || "{}");
      const questions = payload.questions ?? {};
      const command = payload.state?.command;
      const script = scripts.get(normalize(command));
      count += 1;
      last = {
        model: payload.model,
        state: payload.state,
        questions: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, question?.type])),
        criteria: Object.fromEntries(Object.entries(questions).filter(([, question]) => question?.criteria).map(([id, question]) => [id, Array.isArray(question.criteria) ? question.criteria.length : Object.keys(question.criteria).length])),
        authorization: request.headers.authorization ? "present" : "missing",
        bytes: raw.length,
      };
      history.push({ command, questions: Object.keys(questions).length, at: Date.now() });

      let gaveUp = false;
      response.on("close", () => {
        if (!response.writableFinished) gaveUp = true;
      });
      if (script?.delayMs) await new Promise((done) => setTimeout(done, script.delayMs));
      if (gaveUp || response.destroyed) {
        aborted += 1;
        return;
      }
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answer(id, question, script?.answers)]));
      reply(200, {
        model: payload.model,
        answers,
        usage: { input_tokens: Math.round(raw.length / 4), output_tokens: Object.keys(questions).length * 4, cost: 0 },
        provider: "TypeSafe",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/script") {
      const { command, answers, delayMs } = JSON.parse((await body(request)) || "{}");
      scripts.set(normalize(command), { answers: answers ?? {}, delayMs: Number(delayMs) || 0 });
      reply(200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/last") {
      reply(200, { last, count, aborted, history });
      return;
    }
    if (request.method === "POST" && url.pathname === "/reset") {
      scripts = new Map();
      last = null;
      count = 0;
      aborted = 0;
      history = [];
      reply(200, { ok: true });
      return;
    }
    reply(404, { error: { message: "Not here" } });
  } catch (error) {
    reply(500, { error: { message: error instanceof Error ? error.message : String(error) } });
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`stub-decisions listening on http://127.0.0.1:${address.port}\n`);
});
