import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { RequestValidationError } from "../domain.js";
import { hashRequest } from "../security.js";
import {
  loadCreditLedger,
  loadWorkspaceCredits,
  rollCycleIfDue,
  refundCredits,
  reserveCredits,
  settleCredits,
} from "../credits.js";
import { CREDIT_PLANS, PLAN_TRANSCRIBE_SECONDS, PLAN_VIDEO_RESOLUTIONS } from "../billing.js";
import { DEFAULT_TRANSCRIBE_MODEL } from "./constants.js";
import { GENERATION_KINDS, quote, validateGeneration } from "./pricing.js";
import * as fishProvider from "./providers/fish.js";
import * as googleProvider from "./providers/google.js";
import * as minimaxProvider from "./providers/minimax.js";
import * as transcribeProvider from "./providers/transcribe.js";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MULTIPART_PATTERN = /^multipart\/form-data(?:;|$)/i;
const MAX_TRANSCRIBE_AUDIO_BYTES = 25 * 1024 * 1024;
const GENERATION_TIMEOUT_MS = {
  image: 300_000,
  video: 900_000,
  voice: 300_000,
  transcribe: 600_000,
};
const OUTPUT_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["video/mp4", ".mp4"],
  ["audio/mpeg", ".mp3"],
  ["audio/wav", ".wav"],
  ["application/json", ".json"],
]);

const defaultProviders = {
  image: googleProvider.generate,
  video: minimaxProvider.generate,
  voice: fishProvider.generate,
  transcribe: transcribeProvider.generate,
};

function idempotencyKeyHeader(request, reply) {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value.length < 8 || value.length > 200) {
    reply.code(400).send({ error: "idempotency_key_required" });
    return undefined;
  }
  return value;
}

function idempotencyActor(request) {
  return request.authContext.kind === "api_key"
    ? `api:${request.authContext.apiKeyId}`
    : `user:${request.authContext.userId}`;
}

async function claimIdempotency(client, request, key, payload) {
  const actorKey = idempotencyActor(request);
  const requestHash = hashRequest(payload);
  const claimed = await client.query(
    `insert into api_idempotency_keys
      (api_key_id, actor_key, idempotency_key, request_hash)
     values ($1, $2, $3, $4)
     on conflict do nothing
     returning actor_key`,
    [request.authContext.apiKeyId ?? null, actorKey, key, requestHash],
  );
  if (claimed.rowCount > 0) return { actorKey, requestHash };

  const existing = await client.query(
    `select request_hash, status_code, response_body, locked_until
     from api_idempotency_keys
     where actor_key = $1 and idempotency_key = $2
     for update`,
    [actorKey, key],
  );
  const record = existing.rows[0];
  if (!record || record.request_hash !== requestHash) {
    return { error: "idempotency_key_reused" };
  }
  if (record.response_body && record.status_code) {
    return {
      replay: {
        statusCode: record.status_code,
        body: record.response_body,
      },
    };
  }
  if (new Date(record.locked_until).getTime() > Date.now()) {
    return { error: "request_in_progress" };
  }
  await client.query(
    `update api_idempotency_keys
     set locked_until = now() + interval '2 minutes'
     where actor_key = $1 and idempotency_key = $2`,
    [actorKey, key],
  );
  return { actorKey, requestHash };
}

async function completeIdempotency(
  client,
  actorKey,
  key,
  statusCode,
  response,
  resourceType,
  resourceId,
) {
  await client.query(
    `update api_idempotency_keys
     set status_code = $3, response_body = $4, resource_type = $5,
         resource_id = $6, completed_at = now()
     where actor_key = $1 and idempotency_key = $2`,
    [actorKey, key, statusCode, JSON.stringify(response), resourceType, resourceId],
  );
}

function publicGeneration(row) {
  return {
    id: row.id,
    kind: row.kind,
    model: row.model,
    status: row.status,
    creditsSettled: Number(row.credits_settled ?? 0),
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

function parsedLimit(request, reply, fallback) {
  const limit = Math.min(100, Math.max(1, Number(request.query?.limit ?? fallback)));
  if (!Number.isInteger(limit)) {
    reply.code(400).send({ error: "invalid_limit" });
    return undefined;
  }
  return limit;
}

function multipartBoundary(request) {
  const contentType = request.headers["content-type"] ?? "";
  return contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
}

/** Minimal multipart/form-data parser over the raw buffered body. */
function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let index = body.indexOf(delimiter);
  while (index !== -1) {
    const start = index + delimiter.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const segment = body.subarray(start + 2, Math.max(start + 2, next - 2));
    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = segment.subarray(0, headerEnd).toString("utf8");
      parts.push({
        name: headers.match(/\bname="([^"]*)"/i)?.[1],
        filename: headers.match(/\bfilename="([^"]*)"/i)?.[1],
        contentType: headers.match(/content-type:\s*([^\r\n;]+)/i)?.[1]?.trim(),
        data: segment.subarray(headerEnd + 4),
      });
    }
    index = next;
  }
  return parts;
}

/**
 * Why this plan may not run this generation, or undefined when it may.
 *
 * Two rules, both about protecting the margin rather than the balance:
 *
 * The editor plan grants no credits at all — it is for people bringing their
 * own provider keys — so its refusal is an upgrade prompt, not a balance
 * error.
 *
 * 2k video costs twice what 768p does per second, and MiniMax's own
 * pay-as-you-go runs to $0.56 a clip. A plan sized against 768p empties twice
 * as fast on 2k, so the tier is gated rather than merely priced: otherwise a
 * plan's margin depends on which resolution its subscribers happen to pick.
 */
function planRefusal(plan, kind, params) {
  const allowed = PLAN_VIDEO_RESOLUTIONS[plan] ?? [];

  if (!plan || CREDIT_PLANS[plan]?.credits === 0) {
    return {
      error: "plan_excludes_generation",
      plan: plan ?? null,
      detail:
        "This plan includes the editor and publishing, not generation. Upgrade to Allstar to generate images, video and voice, or add your own provider keys.",
      upgradeTo: "allstar",
    };
  }

  if (kind === "video" && !allowed.includes(params.resolution)) {
    return {
      error: "plan_excludes_resolution",
      plan,
      resolution: params.resolution,
      detail: `${params.resolution} video is not included in the ${plan} plan.`,
      upgradeTo: "superstar",
    };
  }

  return undefined;
}

/**
 * Take `seconds` out of the workspace's transcription allowance, or say why
 * it cannot be taken.
 *
 * The check and the increment are one statement for the same reason the
 * credit reserve is: reading a total and then deciding lets concurrent
 * requests all pass against the same stale number.
 */
async function consumeTranscribeSeconds(postgres, workspaceId, seconds) {
  await rollCycleIfDue(postgres, workspaceId, (plan) => CREDIT_PLANS[plan]?.credits ?? 0);
  const account = await postgres.query(
    "select plan, transcribe_seconds_used from workspace_credits where workspace_id = $1",
    [workspaceId],
  );
  const plan = account.rows[0]?.plan ?? null;
  const allowance = PLAN_TRANSCRIBE_SECONDS[plan] ?? 0;

  if (allowance === 0) {
    return {
      error: "plan_excludes_transcription",
      plan,
      detail:
        "This plan does not include transcription. Upgrade to Allstar for 120 minutes a cycle, or add your own transcription key.",
      upgradeTo: "allstar",
    };
  }

  const claimed = await postgres.query(
    `update workspace_credits
        set transcribe_seconds_used = transcribe_seconds_used + $2
      where workspace_id = $1 and transcribe_seconds_used + $2 <= $3
      returning transcribe_seconds_used`,
    [workspaceId, seconds, allowance],
  );

  if (!claimed.rows[0]) {
    const used = Number(account.rows[0]?.transcribe_seconds_used ?? 0);
    return {
      error: "transcription_limit_reached",
      plan,
      usedMinutes: Math.round(used / 60),
      limitMinutes: Math.round(allowance / 60),
      detail: `This cycle's ${Math.round(allowance / 60)} minutes of transcription are used up.`,
    };
  }

  return undefined;
}

export function registerAiRoutes(
  app,
  {
    postgres,
    requireScope,
    requiredWorkspace,
    r2,
    r2Bucket,
    logger = console,
    providers = {},
  },
) {
  const providerFor = (kind) => providers[kind] ?? defaultProviders[kind];
  const inflight = new Set();
  function track(promise) {
    inflight.add(promise);
    promise.catch(() => undefined).finally(() => inflight.delete(promise));
  }

  function extensionFor(mimeType) {
    return OUTPUT_EXTENSIONS.get(mimeType) ?? ".bin";
  }

  /** Persist a provider result: R2 media asset when possible, else inline. */
  async function storeOutput(task, result) {
    const meta = result.meta ?? {};
    const mockFlag = meta.mock ? { mock: true } : {};
    if (meta.segments) {
      return { segments: meta.segments, ...mockFlag };
    }
    const bytes = result.bytes ? Buffer.from(result.bytes) : undefined;
    if (bytes && r2 && r2Bucket) {
      const mediaId = randomUUID();
      const extension = extensionFor(result.mimeType);
      const key = `ai/${task.workspaceId}/${mediaId}/output${extension}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Bucket,
          Key: key,
          Body: bytes,
          ContentType: result.mimeType,
        }),
      );
      await postgres.query(
        `insert into media_assets
          (id, workspace_id, original_filename, r2_key, mime_type, size_bytes,
           status, upload_completed_at)
         values ($1, $2, $3, $4, $5, $6, 'ready', now())`,
        [
          mediaId,
          task.workspaceId,
          `ai-${task.kind}-${task.generationId}${extension}`,
          key,
          result.mimeType,
          bytes.length,
        ],
      );
      return {
        mediaId,
        r2Key: key,
        mimeType: result.mimeType,
        sizeBytes: bytes.length,
        provider: meta.provider,
        ...mockFlag,
      };
    }
    if (bytes) {
      // No object storage configured (or mock mode): inline a data URL so the
      // feature stays fully demoable; real deployments store bytes in R2.
      return {
        dataUrl: `data:${result.mimeType};base64,${bytes.toString("base64")}`,
        mimeType: result.mimeType,
        sizeBytes: bytes.length,
        provider: meta.provider,
        ...mockFlag,
      };
    }
    if (result.url) {
      return {
        url: result.url,
        mimeType: result.mimeType,
        sizeBytes: meta.sizeBytes,
        provider: meta.provider,
        ...mockFlag,
      };
    }
    return { mimeType: result.mimeType, ...mockFlag };
  }

  async function markSucceeded(task, output) {
    const client = await postgres.connect();
    try {
      await client.query("begin");
      await client.query(
        `update ai_generations
         set status = 'succeeded', credits_settled = credits_quoted,
             output = $2, error = null, updated_at = now()
         where id = $1`,
        [task.generationId, JSON.stringify(output)],
      );
      await settleCredits(client, {
        workspaceId: task.workspaceId,
        credits: task.credits,
        generationId: task.generationId,
        note: `Settled ${task.credits} credits for ${task.kind} generation`,
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function markFailed(task, error) {
    const summary = String(error instanceof Error ? error.message : error).slice(0, 500);
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const failed = await client.query(
        `update ai_generations
         set status = 'failed', error = $2, updated_at = now()
         where id = $1 and status in ('reserved', 'running')
         returning id`,
        [task.generationId, summary],
      );
      if (failed.rows[0]) {
        await refundCredits(client, {
          workspaceId: task.workspaceId,
          credits: task.credits,
          generationId: task.generationId,
          note: `Refunded ${task.credits} credits after ${task.kind} generation failed`,
        });
      }
      await client.query("commit");
    } catch (refundError) {
      await client.query("rollback").catch(() => undefined);
      throw refundError;
    } finally {
      client.release();
    }
    return summary;
  }

  async function runGeneration(task) {
    try {
      await postgres.query(
        `update ai_generations
         set status = 'running', updated_at = now()
         where id = $1 and status = 'reserved'`,
        [task.generationId],
      );
      const result = await providerFor(task.kind)({
        model: task.model,
        params: task.params,
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS[task.kind]),
      });
      const output = await storeOutput(task, result);
      await markSucceeded(task, output);
      return output;
    } catch (error) {
      logger.warn?.(
        { err: error, generationId: task.generationId },
        "AI generation failed; refunding reserved credits",
      );
      const summary = await markFailed(task, error).catch((refundError) => {
        logger.error?.(
          { err: refundError, generationId: task.generationId },
          "AI generation refund failed",
        );
        return String(error?.message ?? error).slice(0, 500);
      });
      throw new Error(summary);
    }
  }

  /**
   * Shared reservation transaction: idempotency claim, declaration-hash
   * dedup, balance reserve, and the reserved ai_generations row.
   */
  async function reserveGeneration(request, reply, key, {
    kind,
    model,
    params,
    declarationHash,
    credits,
    respondStatus,
    completeInTransaction,
  }) {
    const workspaceId = requiredWorkspace(request);
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const idempotency = await claimIdempotency(client, request, key, {
        operation: "ai.generate",
        kind,
        model,
        params,
        declarationHash: declarationHash ?? null,
      });
      if (idempotency.error) {
        await client.query("rollback");
        reply.code(409).send({ error: idempotency.error });
        return undefined;
      }
      if (idempotency.replay) {
        await client.query("commit");
        reply
          .header("idempotent-replayed", "true")
          .code(idempotency.replay.statusCode)
          .send(idempotency.replay.body);
        return undefined;
      }

      if (declarationHash) {
        const existing = await client.query(
          `select id, output from ai_generations
           where workspace_id = $1 and declaration_hash = $2
             and status = 'succeeded'
           order by created_at desc
           limit 1`,
          [workspaceId, declarationHash],
        );
        if (existing.rows[0]) {
          const response = {
            generationId: existing.rows[0].id,
            status: "succeeded",
            output: existing.rows[0].output,
            deduped: true,
            creditsCharged: 0,
          };
          await completeIdempotency(
            client,
            idempotency.actorKey,
            key,
            200,
            response,
            "ai_generation",
            existing.rows[0].id,
          );
          await client.query("commit");
          reply.code(200).send(response);
          return undefined;
        }
      }

      // What the plan allows, before what the balance allows. A subscriber on
      // the editor plan has no credits by design, so telling them they are out
      // of credits would be both true and useless — the answer is to upgrade.
      // Refill first: credits renew monthly from the payment date, and a
      // yearly subscriber's renewal arrives here rather than from Stripe.
      await rollCycleIfDue(client, workspaceId, (plan) => CREDIT_PLANS[plan]?.credits ?? 0);
      const account = await loadWorkspaceCredits(client, workspaceId);
      const refusal = planRefusal(account.plan, kind, params);
      if (refusal) {
        await client.query("rollback");
        reply.code(403).send(refusal);
        return undefined;
      }

      const generationId = randomUUID();
      const inserted = await client.query(
        `insert into ai_generations
          (id, workspace_id, idempotency_key, declaration_hash, kind, model,
           params, status, credits_quoted)
         values ($1, $2, $3, $4, $5, $6, $7, 'reserved', $8)
         on conflict (workspace_id, idempotency_key) do nothing
         returning id`,
        [
          generationId,
          workspaceId,
          key,
          declarationHash ?? null,
          kind,
          model,
          JSON.stringify(params),
          credits,
        ],
      );
      if (!inserted.rows[0]) {
        await client.query("rollback");
        reply.code(409).send({ error: "idempotency_key_reused" });
        return undefined;
      }
      const remaining = await reserveCredits(client, {
        workspaceId,
        credits,
        generationId,
        note: `Reserved ${credits} credits for ${kind} generation`,
      });
      if (remaining === undefined) {
        const account = await loadWorkspaceCredits(client, workspaceId);
        await client.query("rollback");
        reply.code(402).send({
          error: "insufficient_credits",
          needed: credits,
          balance: account.balance,
          cycleResetsAt: account.cycleResetsAt,
        });
        return undefined;
      }
      const response = { generationId, credits, status: "reserved" };
      if (completeInTransaction) {
        await completeIdempotency(
          client,
          idempotency.actorKey,
          key,
          respondStatus,
          response,
          "ai_generation",
          generationId,
        );
      }
      await client.query("commit");
      return {
        generationId,
        workspaceId,
        actorKey: idempotency.actorKey,
        response,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  app.get(
    "/v1/credits",
    { preHandler: requireScope("ai:read") },
    async (request) => {
      // Reading the balance is the commonest way a due refill is noticed:
      // the panel asks for it every time it opens.
      const workspaceId = requiredWorkspace(request);
      await rollCycleIfDue(postgres, workspaceId, (plan) => CREDIT_PLANS[plan]?.credits ?? 0);
      return loadWorkspaceCredits(postgres, workspaceId);
    },
  );

  app.get(
    "/v1/credits/ledger",
    { preHandler: requireScope("ai:read") },
    async (request, reply) => {
      const limit = parsedLimit(request, reply, 50);
      if (!limit) return;
      return {
        entries: await loadCreditLedger(postgres, requiredWorkspace(request), limit),
      };
    },
  );

  app.post(
    "/v1/ai/generate",
    { preHandler: requireScope("ai:write") },
    async (request, reply) => {
      const key = idempotencyKeyHeader(request, reply);
      if (!key) return;
      const body = request.body ?? {};
      const { kind, model } = body;
      if (!GENERATION_KINDS.has(kind)) {
        return reply.code(400).send({ error: "invalid_generation_kind" });
      }
      const mode = body.mode;
      if (mode !== "quote" && mode !== "execute") {
        return reply.code(400).send({ error: "invalid_generation_mode" });
      }
      const declarationHash = body.declarationHash;
      if (
        declarationHash !== undefined &&
        (typeof declarationHash !== "string" ||
          declarationHash.length < 8 ||
          declarationHash.length > 200)
      ) {
        return reply.code(400).send({ error: "invalid_declaration_hash" });
      }
      let params;
      let priced;
      try {
        params = validateGeneration(kind, model, body.params);
        priced = quote(kind, model, params);
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return reply.code(400).send({ error: error.code, details: error.details });
        }
        throw error;
      }
      if (mode === "quote") {
        return reply.code(200).send({
          credits: priced.credits,
          lineItems: priced.lineItems,
        });
      }
      const reserved = await reserveGeneration(request, reply, key, {
        kind,
        model,
        params,
        declarationHash,
        credits: priced.credits,
        respondStatus: 202,
        completeInTransaction: true,
      });
      if (!reserved) return;

      track(
        runGeneration({
          generationId: reserved.generationId,
          workspaceId: reserved.workspaceId,
          kind,
          model,
          params,
          credits: priced.credits,
        }).catch(() => undefined),
      );
      return reply.code(202).send(reserved.response);
    },
  );

  app.get(
    "/v1/ai/generations",
    { preHandler: requireScope("ai:read") },
    async (request, reply) => {
      const limit = parsedLimit(request, reply, 25);
      if (!limit) return;
      const result = await postgres.query(
        `select id, kind, model, status, credits_settled, output, error, created_at
         from ai_generations
         where workspace_id = $1
         order by created_at desc, id desc
         limit $2`,
        [requiredWorkspace(request), limit],
      );
      return { generations: result.rows.map(publicGeneration) };
    },
  );

  app.get(
    "/v1/ai/generations/:id",
    { preHandler: requireScope("ai:read") },
    async (request, reply) => {
      if (!uuidPattern.test(request.params.id)) {
        return reply.code(400).send({ error: "invalid_generation_id" });
      }
      const result = await postgres.query(
        `select id, kind, model, status, credits_settled, output, error, created_at
         from ai_generations
         where id = $1 and workspace_id = $2`,
        [request.params.id, requiredWorkspace(request)],
      );
      if (!result.rows[0]) {
        return reply.code(404).send({ error: "generation_not_found" });
      }
      return publicGeneration(result.rows[0]);
    },
  );

  app.register(async (scope) => {
    // The transcribe route accepts multipart audio; buffer the raw body in
    // this encapsulated scope so binary uploads survive intact.
    try {
      scope.removeContentTypeParser(MULTIPART_PATTERN);
    } catch {
      // The parent scope may not define a multipart parser (tests do not).
    }
    scope.addContentTypeParser(
      MULTIPART_PATTERN,
      { parseAs: "buffer", bodyLimit: MAX_TRANSCRIBE_AUDIO_BYTES + 1_048_576 },
      (_request, body, done) => done(null, body),
    );

    scope.post(
      "/v1/ai/transcribe",
      {
        preHandler: requireScope("ai:write"),
        bodyLimit: MAX_TRANSCRIBE_AUDIO_BYTES + 1_048_576,
      },
      async (request, reply) => {
        const key = idempotencyKeyHeader(request, reply);
        if (!key) return;
        const workspaceId = requiredWorkspace(request);

        let durationSec;
        let mediaId;
        let audio;
        if (Buffer.isBuffer(request.body)) {
          const boundary = multipartBoundary(request);
          if (!boundary) {
            return reply.code(400).send({ error: "invalid_transcription_request" });
          }
          const parts = parseMultipart(request.body, boundary);
          const durationPart = parts.find((part) => part.name === "durationSec");
          durationSec = durationPart
            ? Number(durationPart.data.toString("utf8").trim())
            : undefined;
          audio = parts.find((part) => part.name === "audio" || part.filename);
          if (audio && audio.data.length > MAX_TRANSCRIBE_AUDIO_BYTES) {
            return reply.code(413).send({ error: "audio_too_large" });
          }
        } else {
          const body = request.body ?? {};
          durationSec = body.durationSec;
          mediaId = body.mediaId;
          if (
            mediaId !== undefined &&
            (typeof mediaId !== "string" || !uuidPattern.test(mediaId))
          ) {
            return reply.code(400).send({ error: "invalid_media_id" });
          }
        }

        const model = DEFAULT_TRANSCRIBE_MODEL;
        let priced;
        try {
          priced = quote("transcribe", model, { durationSec });
        } catch (error) {
          if (error instanceof RequestValidationError) {
            return reply.code(400).send({ error: error.code, details: error.details });
          }
          throw error;
        }

        let media;
        if (mediaId) {
          const mediaResult = await postgres.query(
            `select r2_key, mime_type, original_filename
             from media_assets
             where id = $1 and workspace_id = $2 and purged_at is null`,
            [mediaId, workspaceId],
          );
          media = mediaResult.rows[0];
          if (!media) return reply.code(404).send({ error: "media_not_found" });
        }

        const params = {
          durationSec,
          ...(mediaId ? { mediaId } : {}),
          ...(audio?.filename ? { filename: audio.filename } : {}),
        };
        // Transcription is allowed by the minute, not charged in credits: at
        // Qwen's rate an hour costs about 13 cents, and a caption job that
        // fails for want of credits fails on the feature that makes
        // short-form video work. The reservation is therefore zero-credit,
        // and the cap is enforced separately.
        const overCap = await consumeTranscribeSeconds(postgres, workspaceId, durationSec);
        if (overCap) {
          // Excluded by the plan is a 403 like every other plan refusal;
          // 429 means the allowance existed and has been used up.
          reply.code(overCap.error === "plan_excludes_transcription" ? 403 : 429).send(overCap);
          return;
        }

        const reserved = await reserveGeneration(request, reply, key, {
          kind: "transcribe",
          model,
          params,
          declarationHash: undefined,
          credits: 0,
          respondStatus: 200,
          completeInTransaction: false,
        });
        if (!reserved) {
          // Give the minutes back: nothing was transcribed.
          await postgres.query(
            `update workspace_credits
                set transcribe_seconds_used = greatest(0, transcribe_seconds_used - $2)
              where workspace_id = $1`,
            [workspaceId, durationSec],
          );
          return;
        }

        const task = {
          generationId: reserved.generationId,
          workspaceId,
          kind: "transcribe",
          model,
          params: {
            ...params,
            bytes: audio?.data,
            mimeType: audio?.contentType,
          },
          credits: 0,
        };
        try {
          if (media && r2 && r2Bucket && !task.params.bytes) {
            const object = await r2.send(
              new GetObjectCommand({ Bucket: r2Bucket, Key: media.r2_key }),
            );
            task.params.bytes = Buffer.from(await object.Body.transformToByteArray());
            task.params.mimeType = media.mime_type;
            task.params.filename = media.original_filename;
          }
          const output = await runGeneration(task);
          const response = {
            segments: output.segments ?? [],
            creditsSettled: 0,
          };
          await completeIdempotency(
            postgres,
            reserved.actorKey,
            key,
            200,
            response,
            "ai_generation",
            reserved.generationId,
          );
          return reply.code(200).send(response);
        } catch (error) {
          // A failure before runGeneration (for example the R2 download)
          // must still refund; markFailed is a no-op once already failed.
          await markFailed(task, error).catch(() => undefined);
          const response = {
            error: "transcription_failed",
            detail: String(error?.message ?? error).slice(0, 300),
            generationId: reserved.generationId,
          };
          await completeIdempotency(
            postgres,
            reserved.actorKey,
            key,
            502,
            response,
            "ai_generation",
            reserved.generationId,
          );
          return reply.code(502).send(response);
        }
      },
    );
  });

  return {
    /** Await every in-flight background generation (used by tests). */
    drain: async () => {
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight]);
      }
    },
  };
}
