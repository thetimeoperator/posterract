import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import Fastify from "fastify";
import {
  DEFAULT_TRANSCRIBE_MODEL,
  FISH_VOICE_MODEL,
  GEMINI_IMAGE_MODEL,
  MINIMAX_VIDEO_MODEL,
} from "../src/ai/constants.js";
import { MOCK_TRANSCRIPTION_SEGMENTS } from "../src/ai/mock.js";
import { quote } from "../src/ai/pricing.js";
import { registerAiRoutes } from "../src/ai/routes.js";

process.env.POSTERRACT_AI_MOCK = "1";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(
  here,
  "../../../deploy/posterract/postgres/init",
);
const migrationNames = [
  "001-posterract.sql",
  "002-postgres-cutover.sql",
  "011-ai-credits.sql",
];
const workspaceId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000202";

function pgPool(postgres) {
  const query = async (text, parameters = []) => {
    const result = await postgres.query(
      typeof text === "object" ? text.text : text,
      typeof text === "object" ? text.values ?? [] : parameters,
    );
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
  };
}

async function database({ balance = 150 } = {}) {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  for (const name of migrationNames) {
    await postgres.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
  }
  await postgres.query(
    `insert into app_users (id, email, display_name)
     values ($1, 'ai@example.test', 'AI Test')`,
    [userId],
  );
  await postgres.query(
    `insert into workspaces (id, owner_id, name)
     values ($1, $2, 'AI Test Workspace')`,
    [workspaceId, userId],
  );
  await postgres.query(
    `insert into workspace_credits
       (workspace_id, plan, balance, allotment, cycle_started_at, cycle_resets_at)
     values ($1, 'creator', $2, 150, now(), now() + interval '30 days')`,
    [workspaceId, balance],
  );
  return { postgres, pool: pgPool(postgres) };
}

async function testApp(pool, providers) {
  const app = Fastify({ logger: false });
  const requireScope = () => async (request) => {
    request.authContext = { kind: "session", userId, workspaceId, role: "owner" };
  };
  const ai = registerAiRoutes(app, {
    postgres: pool,
    requireScope,
    requiredWorkspace: (request) => request.authContext.workspaceId,
    logger: { warn() {}, error() {} },
    ...(providers ? { providers } : {}),
  });
  return { app, ai };
}

async function generate(app, key, body) {
  return app.inject({
    method: "POST",
    url: "/v1/ai/generate",
    headers: { "idempotency-key": key },
    payload: body,
  });
}

function imageBody(overrides = {}) {
  return {
    kind: "image",
    model: GEMINI_IMAGE_MODEL,
    params: { prompt: "A neon-green tesseract artifact", resolution: "2k" },
    mode: "execute",
    ...overrides,
  };
}

test("quotes price every kind, including edge durations, and reject bad params", () => {
  assert.deepEqual(
    quote("image", GEMINI_IMAGE_MODEL, { prompt: "p", resolution: "1k" }),
    { credits: 10, lineItems: [{ label: "Image 1k", credits: 10 }] },
  );
  assert.equal(
    quote("image", GEMINI_IMAGE_MODEL, { prompt: "p", resolution: "2k" }).credits,
    15,
  );

  const shortVideo = quote("video", MINIMAX_VIDEO_MODEL, {
    prompt: "p",
    resolution: "768p",
    durationSec: 4,
    aspectRatio: "9:16",
  });
  assert.equal(shortVideo.credits, 48);
  assert.equal(shortVideo.lineItems[0].label, "Video 768p × 4s @ 12/s");
  assert.equal(
    quote("video", MINIMAX_VIDEO_MODEL, {
      prompt: "p",
      resolution: "2k",
      durationSec: 15,
      aspectRatio: "21:9",
    }).credits,
    300,
  );
  assert.equal(
    quote("video", MINIMAX_VIDEO_MODEL, {
      prompt: "p",
      resolution: "2k",
      durationSec: 10,
      aspectRatio: "adaptive",
    }).credits,
    200,
  );
  for (const durationSec of [3, 16, 4.5]) {
    assert.throws(
      () =>
        quote("video", MINIMAX_VIDEO_MODEL, {
          prompt: "p",
          resolution: "768p",
          durationSec,
        }),
      /invalid_generation_params/,
    );
  }
  assert.throws(
    () =>
      quote("video", MINIMAX_VIDEO_MODEL, {
        prompt: "p",
        resolution: "1080p",
        durationSec: 5,
      }),
    /invalid_generation_params/,
  );
  assert.throws(
    () =>
      quote("video", MINIMAX_VIDEO_MODEL, {
        prompt: "p",
        resolution: "768p",
        durationSec: 5,
        aspectRatio: "2:1",
      }),
    /invalid_generation_params/,
  );
  assert.throws(
    () => quote("video", "sora-9", { prompt: "p", resolution: "768p", durationSec: 5 }),
    /invalid_generation_model/,
  );
  assert.throws(
    () => quote("image", GEMINI_IMAGE_MODEL, { prompt: "p", resolution: "4k" }),
    /invalid_generation_params/,
  );

  assert.equal(quote("voice", FISH_VOICE_MODEL, { text: "a" }).credits, 3);
  assert.equal(
    quote("voice", FISH_VOICE_MODEL, { text: "a".repeat(1_000) }).credits,
    3,
  );
  assert.equal(
    quote("voice", FISH_VOICE_MODEL, { text: "a".repeat(1_001) }).credits,
    6,
  );
  assert.equal(
    quote("voice", FISH_VOICE_MODEL, { text: "a".repeat(2_500) }).credits,
    9,
  );
  assert.throws(
    () => quote("voice", FISH_VOICE_MODEL, { text: "" }),
    /invalid_generation_params/,
  );

  assert.equal(quote("transcribe", DEFAULT_TRANSCRIBE_MODEL, { durationSec: 59 }).credits, 1);
  assert.equal(quote("transcribe", DEFAULT_TRANSCRIBE_MODEL, { durationSec: 61 }).credits, 2);
  assert.throws(
    () => quote("transcribe", DEFAULT_TRANSCRIBE_MODEL, { durationSec: 0 }),
    /invalid_generation_params/,
  );
});

test("execute reserves credits, settles on success, and exposes the generation", async () => {
  const { postgres, pool } = await database();
  const { app, ai } = await testApp(pool);
  try {
    const quoted = await generate(app, "ai-quote-00000001", imageBody({ mode: "quote" }));
    assert.equal(quoted.statusCode, 200);
    assert.deepEqual(quoted.json(), {
      credits: 15,
      lineItems: [{ label: "Image 2k", credits: 15 }],
    });

    const executed = await generate(app, "ai-image-00000001", imageBody());
    assert.equal(executed.statusCode, 202);
    const { generationId, credits, status } = executed.json();
    assert.equal(credits, 15);
    assert.equal(status, "reserved");
    await ai.drain();

    const read = await app.inject({
      method: "GET",
      url: `/v1/ai/generations/${generationId}`,
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().status, "succeeded");
    assert.equal(read.json().kind, "image");
    assert.equal(read.json().creditsSettled, 15);
    assert.equal(read.json().output.mock, true);
    assert.match(read.json().output.dataUrl, /^data:image\/png;base64,/);
    assert.equal(typeof read.json().createdAt, "number");

    const creditsState = await app.inject({ method: "GET", url: "/v1/credits" });
    assert.equal(creditsState.statusCode, 200);
    assert.equal(creditsState.json().plan, "creator");
    assert.equal(creditsState.json().balance, 135);
    assert.equal(creditsState.json().allotment, 150);
    assert.equal(typeof creditsState.json().cycleResetsAt, "number");

    const ledger = await app.inject({ method: "GET", url: "/v1/credits/ledger" });
    assert.equal(ledger.statusCode, 200);
    const entries = ledger.json().entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].kind, "settle");
    assert.equal(entries[0].delta, 0);
    assert.equal(entries[0].generationId, generationId);
    assert.equal(entries[1].kind, "reserve");
    assert.equal(entries[1].delta, -15);
    assert.equal(entries[1].generationId, generationId);

    const list = await app.inject({ method: "GET", url: "/v1/ai/generations" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().generations.length, 1);
    assert.equal(list.json().generations[0].id, generationId);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("idempotency replay returns the first response without a second charge", async () => {
  const { postgres, pool } = await database();
  const { app, ai } = await testApp(pool);
  try {
    const first = await generate(app, "ai-image-replay-01", imageBody());
    assert.equal(first.statusCode, 202);
    await ai.drain();

    const replay = await generate(app, "ai-image-replay-01", imageBody());
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.headers["idempotent-replayed"], "true");
    assert.deepEqual(replay.json(), first.json());

    const reused = await generate(
      app,
      "ai-image-replay-01",
      imageBody({ params: { prompt: "different", resolution: "1k" } }),
    );
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().error, "idempotency_key_reused");

    const rows = await pool.query(
      "select count(*)::int as count from ai_generations where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(rows.rows[0].count, 1);
    const balance = await pool.query(
      "select balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(balance.rows[0].balance), 135);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("declaration-hash dedup returns the finished output and charges zero", async () => {
  const { postgres, pool } = await database();
  const { app, ai } = await testApp(pool);
  const declarationHash = "sha256:banana-hero-frame-1";
  try {
    const first = await generate(
      app,
      "ai-dedup-000000001",
      imageBody({ declarationHash }),
    );
    assert.equal(first.statusCode, 202);
    await ai.drain();

    const deduped = await generate(
      app,
      "ai-dedup-000000002",
      imageBody({ declarationHash }),
    );
    assert.equal(deduped.statusCode, 200);
    assert.equal(deduped.json().deduped, true);
    assert.equal(deduped.json().creditsCharged, 0);
    assert.equal(deduped.json().status, "succeeded");
    assert.equal(deduped.json().generationId, first.json().generationId);
    assert.match(deduped.json().output.dataUrl, /^data:image\/png;base64,/);

    const balance = await pool.query(
      "select balance from workspace_credits where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(Number(balance.rows[0].balance), 135);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("provider failures mark the generation failed and refund the balance", async () => {
  const { postgres, pool } = await database();
  const { app, ai } = await testApp(pool, {
    image: async () => {
      throw new Error("provider exploded");
    },
  });
  try {
    const executed = await generate(app, "ai-image-failure-1", imageBody());
    assert.equal(executed.statusCode, 202);
    await ai.drain();

    const read = await app.inject({
      method: "GET",
      url: `/v1/ai/generations/${executed.json().generationId}`,
    });
    assert.equal(read.json().status, "failed");
    assert.equal(read.json().creditsSettled, 0);
    assert.match(read.json().error, /provider exploded/);

    const creditsState = await app.inject({ method: "GET", url: "/v1/credits" });
    assert.equal(creditsState.json().balance, 150);
    const ledger = await app.inject({ method: "GET", url: "/v1/credits/ledger" });
    assert.equal(ledger.json().entries[0].kind, "refund");
    assert.equal(ledger.json().entries[0].delta, 15);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("insufficient balances get a 402 and the reservation is released", async () => {
  const { postgres, pool } = await database({ balance: 10 });
  const { app, ai } = await testApp(pool);
  const videoBody = {
    kind: "video",
    model: MINIMAX_VIDEO_MODEL,
    params: { prompt: "p", resolution: "768p", durationSec: 4, aspectRatio: "9:16" },
    mode: "execute",
  };
  try {
    const rejected = await generate(app, "ai-video-poor-0001", videoBody);
    assert.equal(rejected.statusCode, 402);
    assert.equal(rejected.json().error, "insufficient_credits");
    assert.equal(rejected.json().needed, 48);
    assert.equal(rejected.json().balance, 10);
    assert.equal(typeof rejected.json().cycleResetsAt, "number");

    const generations = await pool.query(
      "select count(*)::int as count from ai_generations where workspace_id = $1",
      [workspaceId],
    );
    assert.equal(generations.rows[0].count, 0);

    // The failed attempt released its idempotency claim, so the same key
    // succeeds once the workspace has enough credits.
    await pool.query(
      "update workspace_credits set balance = 100 where workspace_id = $1",
      [workspaceId],
    );
    const retried = await generate(app, "ai-video-poor-0001", videoBody);
    assert.equal(retried.statusCode, 202);
    await ai.drain();
    const creditsState = await app.inject({ method: "GET", url: "/v1/credits" });
    assert.equal(creditsState.json().balance, 52);
  } finally {
    await app.close();
    await postgres.close();
  }
});

test("transcription charges by the minute and returns mock segments", async () => {
  const { postgres, pool } = await database();
  const { app } = await testApp(pool);
  try {
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/ai/transcribe",
      headers: { "idempotency-key": "transcribe-bad-0001" },
      payload: { durationSec: 0 },
    });
    assert.equal(invalid.statusCode, 400);

    const transcribed = await app.inject({
      method: "POST",
      url: "/v1/ai/transcribe",
      headers: { "idempotency-key": "transcribe-json-001" },
      payload: { durationSec: 130 },
    });
    assert.equal(transcribed.statusCode, 200);
    assert.deepEqual(transcribed.json().segments, MOCK_TRANSCRIPTION_SEGMENTS);
    assert.equal(transcribed.json().creditsSettled, 3);
    assert.equal(transcribed.json().segments[0].words[0].text, "Posterract");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/ai/transcribe",
      headers: { "idempotency-key": "transcribe-json-001" },
      payload: { durationSec: 130 },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.headers["idempotent-replayed"], "true");
    assert.deepEqual(replay.json(), transcribed.json());

    const boundary = "----posterract-test-boundary";
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="durationSec"\r\n\r\n61\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="audio"; filename="clip.mp3"\r\ncontent-type: audio/mpeg\r\n\r\n`,
      ),
      Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: "/v1/ai/transcribe",
      headers: {
        "idempotency-key": "transcribe-mult-001",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart,
    });
    assert.equal(uploaded.statusCode, 200);
    assert.equal(uploaded.json().creditsSettled, 2);
    assert.deepEqual(uploaded.json().segments, MOCK_TRANSCRIPTION_SEGMENTS);

    const creditsState = await app.inject({ method: "GET", url: "/v1/credits" });
    assert.equal(creditsState.json().balance, 145);
    const generations = await pool.query(
      `select kind, status, credits_settled from ai_generations
       where workspace_id = $1 order by created_at asc`,
      [workspaceId],
    );
    assert.equal(generations.rows.length, 2);
    assert.equal(generations.rows[0].kind, "transcribe");
    assert.equal(generations.rows[0].status, "succeeded");
  } finally {
    await app.close();
    await postgres.close();
  }
});
