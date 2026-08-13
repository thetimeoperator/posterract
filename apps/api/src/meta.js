import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const META_PROVIDERS = new Set(["instagram", "facebook", "threads"]);

class CallbackError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function secretFor(provider) {
  const name = {
    instagram: "INSTAGRAM_APP_SECRET",
    facebook: "FACEBOOK_APP_SECRET",
    threads: "THREADS_APP_SECRET",
  }[provider];
  const secret = name ? process.env[name] : undefined;
  if (!secret) throw new CallbackError(`${provider} callback is not configured`, 503);
  return secret;
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CallbackError("Malformed signed request", 400);
  }
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new CallbackError("Malformed signed request", 400);
  }
}

function signedRequestFromBody(body) {
  if (typeof body === "string") {
    const formEncoded = new URLSearchParams(body).get("signed_request");
    if (formEncoded) return formEncoded;
    const multipart = body.match(
      /name="signed_request"\r?\n(?:[^\r\n]*\r?\n)*\r?\n([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
    );
    return multipart?.[1];
  }
  if (body && typeof body === "object" && typeof body.signed_request === "string") {
    return body.signed_request;
  }
  return undefined;
}

export function verifyMetaSignedRequest(provider, signedRequest) {
  if (!META_PROVIDERS.has(provider)) {
    throw new CallbackError("Unsupported provider", 404);
  }
  if (typeof signedRequest !== "string" || signedRequest.length > 65_536) {
    throw new CallbackError("Missing signed_request", 400);
  }
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CallbackError("Malformed signed request", 400);
  }
  const received = decodeBase64Url(parts[0]);
  const expected = createHmac("sha256", secretFor(provider))
    .update(parts[1])
    .digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new CallbackError("Invalid signed request", 401);
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
  } catch {
    throw new CallbackError("Malformed signed request payload", 400);
  }
  if (
    String(payload?.algorithm ?? "").toUpperCase() !== "HMAC-SHA256" ||
    typeof payload?.user_id !== "string" ||
    payload.user_id.length === 0 ||
    payload.user_id.length > 256 ||
    typeof payload?.issued_at !== "number" ||
    !Number.isFinite(payload.issued_at) ||
    payload.issued_at <= 0
  ) {
    throw new CallbackError("Malformed signed request payload", 400);
  }
  return { userId: payload.user_id, issuedAt: payload.issued_at };
}

function deletionKey(provider, userId, issuedAt) {
  return createHmac("sha256", secretFor(provider))
    .update(`posterract-meta-deletion:${provider}:${userId}:${issuedAt}`)
    .digest("hex");
}

function confirmationCode() {
  return `PRT${randomBytes(16).toString("hex").toUpperCase()}`;
}

function statusUrl(code) {
  const base = process.env.SITE_URL ?? "https://www.posterract.app";
  const url = new URL("/data-deletion", base);
  url.searchParams.set("code", code);
  return url.toString();
}

async function findConnections(postgres, provider, providerUserId) {
  if (provider === "facebook") {
    return postgres.query(
      `select distinct a.id, a.workspace_id
       from social_accounts a
       left join social_account_tokens t on t.social_account_id = a.id
       where a.provider = 'facebook'
         and coalesce(t.provider_auth_user_id, a.provider_auth_user_id) = $1`,
      [providerUserId],
    );
  }
  return postgres.query(
    `select id, workspace_id
     from social_accounts
     where provider = $1 and provider_account_id = $2`,
    [provider, providerUserId],
  );
}

async function clearConnection(postgres, account, provider, scrubPlatformData) {
  const client = await postgres.connect();
  try {
    await client.query("begin");
    if (scrubPlatformData) {
      await client.query(
        `update projections
         set platform_post_id = null, platform_post_url = null,
             platform_media_id = null, pending_container_id = null,
             status = case
               when status in ('pending', 'scheduled', 'uploading', 'publishing',
                               'processing', 'retrying')
                 then 'needs_reauth'
               else status
             end,
             error_category = case
               when status in ('pending', 'scheduled', 'uploading', 'publishing',
                               'processing', 'retrying')
                 then 'auth'
               else error_category
             end,
             error_summary = case
               when status in ('pending', 'scheduled', 'uploading', 'publishing',
                               'processing', 'retrying')
                 then $3
               else error_summary
             end,
             updated_at = now()
         where workspace_id = $1 and social_account_id = $2 and provider = $4`,
        [
          account.workspace_id,
          account.id,
          `${provider} authorization was removed`,
          provider,
        ],
      );
      await client.query(
        `delete from events
         where workspace_id = $1 and (
           projection_id in (
             select id from projections where social_account_id = $2
           )
           or (type = 'portal.connected' and lower(message) like $3)
         )`,
        [account.workspace_id, account.id, `${provider} connected%`],
      );
    }
    await client.query(
      `delete from publication_metric_snapshots
       where projection_id in (
         select id from projections where social_account_id = $1
       )`,
      [account.id],
    );
    await client.query(
      "delete from account_metric_snapshots where social_account_id = $1",
      [account.id],
    );
    await client.query(
      "delete from daily_metric_snapshots where social_account_id = $1",
      [account.id],
    );
    await client.query(
      "delete from social_account_tokens where social_account_id = $1",
      [account.id],
    );
    await client.query(
      `update social_accounts
       set provider_account_id = null, provider_auth_user_id = null,
           handle = 'not connected', display_name = null, avatar_url = null,
           status = 'disconnected', scopes = '{}', token_expires_at = null,
           metadata = '{}', updated_at = now()
       where id = $1`,
      [account.id],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function handleMetaCallback(postgres, request, reply, provider, kind) {
  try {
    const signedRequest = signedRequestFromBody(request.body);
    const { userId, issuedAt } = verifyMetaSignedRequest(provider, signedRequest);
    const connections = await findConnections(postgres, provider, userId);
    if (kind === "deauthorize") {
      for (const connection of connections.rows) {
        await clearConnection(postgres, connection, provider, false);
      }
      return reply.header("cache-control", "no-store").code(200).send();
    }

    const requestHash = deletionKey(provider, userId, issuedAt);
    const code = confirmationCode();
    const receipt = await postgres.query(
      `insert into meta_deletion_requests
        (provider, confirmation_code, signed_request_hash, status,
         requested_at)
       values ($1, $2, $3, 'processing', now())
       on conflict (signed_request_hash) do update
       set signed_request_hash = excluded.signed_request_hash
       returning id, confirmation_code, status, deleted_connections`,
      [provider, code, requestHash],
    );
    const row = receipt.rows[0];
    if (row.status !== "completed") {
      for (const connection of connections.rows) {
        await clearConnection(postgres, connection, provider, true);
      }
      await postgres.query(
        `update meta_deletion_requests
         set status = 'completed',
             deleted_connections = greatest(deleted_connections, $2),
             completed_at = now()
         where id = $1`,
        [row.id, connections.rowCount],
      );
    }
    return reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .send({
        url: statusUrl(row.confirmation_code),
        confirmation_code: row.confirmation_code,
      });
  } catch (error) {
    const status = error instanceof CallbackError ? error.status : 500;
    request.log.warn({ err: error, provider, kind }, "Meta callback failed");
    return reply
      .header("cache-control", "no-store")
      .code(status)
      .send({
        error:
          status >= 500 ? "Callback processing failed" : "Invalid callback request",
      });
  }
}

export function registerMetaRoutes(app, { postgres }) {
  for (const provider of META_PROVIDERS) {
    app.post(
      `/api/meta/${provider}/deauthorize`,
      { bodyLimit: 65_536 },
      (request, reply) =>
        handleMetaCallback(postgres, request, reply, provider, "deauthorize"),
    );
    app.post(
      `/api/meta/${provider}/data-deletion`,
      { bodyLimit: 65_536 },
      (request, reply) =>
        handleMetaCallback(postgres, request, reply, provider, "data-deletion"),
    );
  }

  app.get("/v1/meta/deletions/:code", async (request, reply) => {
    const code = String(request.params.code ?? "").trim().toUpperCase();
    if (!/^PRT[A-F0-9]{32}$/.test(code)) {
      return reply.code(404).send({ error: "deletion_request_not_found" });
    }
    const result = await postgres.query(
      `select provider, status, requested_at, completed_at
       from meta_deletion_requests where confirmation_code = $1`,
      [code],
    );
    const row = result.rows[0];
    if (!row) return reply.code(404).send({ error: "deletion_request_not_found" });
    return {
      provider: row.provider,
      status: row.status === "completed" ? "completed" : "processing",
      requestedAt: new Date(row.requested_at).getTime(),
      completedAt: row.completed_at
        ? new Date(row.completed_at).getTime()
        : undefined,
    };
  });
}
