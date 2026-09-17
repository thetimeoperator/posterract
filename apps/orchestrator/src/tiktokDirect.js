import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { validateTikTokOptions } from "../../../packages/contract/src/tiktok.ts";
import { tiktokCreatorInfo, tiktokInitDirect, tiktokDirectStatus, tiktokPostingRestrictionMessage } from "../../web/convex/connectors/tiktokDirect.ts";
import { tiktokMediaUrl } from "../../api/src/tiktokMedia.js";

/** Short, restart-safe activities. The database is the boundary for all external side effects. */
export function createTikTokDirectActivities({ postgres, r2, environment = process.env, loadProjectionContext,
  accessTokenFor, signedMediaUrl, prepareMedia, creatorInfo = tiktokCreatorInfo,
  initDirect = tiktokInitDirect, fetchStatus = tiktokDirectStatus }) {
  const sessionFor = async (id) => (await postgres.query("select * from tiktok_publish_sessions where projection_id = $1", [id])).rows[0];
  async function context(id) {
    const row = await loadProjectionContext(id);
    if (!row || row.provider !== "tiktok" || row.platform_options?.mode !== "direct") throw new Error("Invalid TikTok Direct Post projection");
    return row;
  }
  async function tokenFor(row) {
    if (row.account_status !== "connected" || !row.access_token_ciphertext) throw Object.assign(new Error("Reconnect the selected TikTok account."), { category: "auth", code: "account_disconnected" });
    return accessTokenFor(row);
  }
  async function fail(id, code, category = "platform") {
    code = String(code).replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/(?:access_token|refresh_token)=[^&\s]+/gi, "token=[redacted]");
    const message = category === "ambiguous"
      ? "TikTok may have received this post, but did not return a recoverable publish ID. Automatic re-upload stopped to avoid a duplicate. Check TikTok before creating another post."
      : tiktokPostingRestrictionMessage(code) ?? (category === "auth" ? `Reconnect the selected TikTok account before retrying (${code}).`
        : `TikTok could not publish this post: ${String(code).slice(0, 220)}. Review the account and post settings.`);
    const status = category === "auth" ? "needs_reauth" : ["config", "ambiguous"].includes(category) ? "blocked" : "failed";
    const result = await postgres.query(`update projections set status = $2, error_category = $3, error_summary = $4,
      next_attempt_at = null, updated_at = now() where id = $1 and status <> 'live' returning *`, [id, status, category, message]);
    const row = result.rows[0];
    if (row) {
      await postgres.query(`insert into events (workspace_id, transmission_id, projection_id, type, message)
        values ($1, $2, $3, 'projection.failed', $4)`, [row.workspace_id, row.transmission_id, id, message]);
      await postgres.query(`update publish_attempts set status = 'failed', provider_code = $2, completed_at = now()
        where projection_id = $1 and status = 'started'`, [id, String(code).slice(0, 200)]);
    }
    return { status: "failed", category };
  }
  async function eligible(row, token, durationMs) {
    const authorization = row.platform_options.authorization;
    if (!authorization?.authorizedAt || authorization.accountId !== row.social_account_id || row.platform_options.consentAccepted !== true) {
      throw Object.assign(new Error("This post needs to be reviewed and authorized in Create Post."), { category: "validation" });
    }
    const info = await creatorInfo(token);
    const reason = validateTikTokOptions(row.platform_options, info, durationMs);
    if (reason) throw Object.assign(new Error(reason), { category: "validation" });
    return info;
  }
  async function complete(row, session, result) {
    const postId = result.publicaly_available_post_id?.find((id) => typeof id === "string" && /^\d+$/.test(id));
    const postUrl = postId && session.creator_username ? `https://www.tiktok.com/@${encodeURIComponent(session.creator_username)}/video/${postId}` : null;
    const client = await postgres.connect();
    try {
      await client.query("begin");
      const changed = await client.query(`update projections set status = 'live', published_at = coalesce(published_at, now()),
        platform_post_id = coalesce($2, platform_post_id), platform_post_url = coalesce($3, platform_post_url),
        error_category = null, error_summary = null, next_attempt_at = null, updated_at = now()
        where id = $1 and status <> 'live' returning id`, [row.id, postId ?? null, postUrl]);
      // A public video ID can arrive after private/public processing has completed.
      if (postId && !changed.rows.length) await client.query(`update projections set platform_post_id = $2,
        platform_post_url = $3, updated_at = now() where id = $1`, [row.id, postId, postUrl]);
      await client.query(`update tiktok_publish_sessions set state = 'complete', last_platform_status = 'PUBLISH_COMPLETE',
        error_code = null, updated_at = now() where id = $1`, [session.id]);
      await client.query(`insert into points_ledger (workspace_id, source, amount, reference_id, note)
        values ($1, 'post', 10, $2, 'TikTok post published') on conflict (reference_id, source) do nothing`, [row.workspace_id, `projection:${row.id}`]);
      await client.query(`update publish_attempts set status = 'succeeded', completed_at = now()
        where projection_id = $1 and status = 'started'`, [row.id]);
      if (changed.rows.length) await client.query(`insert into events (workspace_id, transmission_id, projection_id, type, message)
        values ($1, $2, $3, 'projection.live', $4)`, [row.workspace_id, row.transmission_id, row.id,
        postUrl ? "Published on TikTok." : "TikTok confirmed publication. A public link is not available yet; private posts may never have one."]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    return { status: "live", platformPostId: postId, platformPostUrl: postUrl };
  }

  return {
    async prepareTikTokDirect(id) {
      const row = await context(id);
      if (row.transmission_status === "canceled") return { status: "canceled" };
      if (row.status === "live") return { status: "live" };
      let session = await sessionFor(id);
      if (session?.publish_id || ["initializing", "ambiguous", "failed"].includes(session?.state)) return { status: "ready" };
      if (session?.state === "prepared" && new Date(session.media_expires_at).getTime() > Date.now() + 3_600_000) return { status: "ready" };
      try { await eligible(row, await tokenFor(row), row.duration_ms); }
      catch (error) {
        if (error.category === "rate_limit" || error.category === "transient") throw error;
        return fail(id, error.code || error.message, error.category || "auth");
      }
      const sessionId = session?.id || randomUUID();
      await postgres.query(`insert into tiktok_publish_sessions (id, projection_id, prepared_key)
        values ($1, $2, $3) on conflict (projection_id) do nothing`, [sessionId, id, `tiktok-prepared/${sessionId}.mp4`]);
      session = await sessionFor(id);
      const preparing = await postgres.query(`update tiktok_publish_sessions set state = 'preparing', media_expires_at = now() + interval '2 hours',
        media_cleaned_at = null, updated_at = now() where id = $1 and publish_id is null
        and state in ('preparing', 'prepared') returning id`, [session.id]);
      if (!preparing.rows.length) return { status: "ready" };
      await postgres.query("update projections set status = 'uploading', error_summary = null, error_category = null, updated_at = now() where id = $1", [id]);
      const prepared = await prepareMedia(await signedMediaUrl(row.r2_key));
      try {
        // Probe the normalized file on the server, not just browser-supplied metadata.
        try { await eligible(row, await tokenFor(row), prepared.durationMs); }
        catch (error) {
          if (["rate_limit", "transient"].includes(error.category)) throw error;
          return fail(id, error.code || error.message, error.category || "validation");
        }
        await r2.send(new PutObjectCommand({ Bucket: environment.R2_BUCKET, Key: session.prepared_key,
          Body: createReadStream(prepared.path), ContentType: "video/mp4", ContentLength: prepared.sizeBytes }));
        await postgres.query(`update tiktok_publish_sessions set state = 'prepared', size_bytes = $2, duration_ms = $3,
          media_expires_at = now() + interval '2 hours', media_cleaned_at = null, updated_at = now()
          where id = $1 and state = 'preparing' and publish_id is null`,
        [session.id, prepared.sizeBytes, prepared.durationMs]);
      } finally { await prepared.cleanup(); }
      return { status: "ready" };
    },

    async initializeTikTokDirect(id) {
      const row = await context(id);
      const session = await sessionFor(id);
      if (session?.publish_id) return { status: session.state === "complete" ? "live" : "processing" };
      if (!session) return fail(id, "media_not_prepared", "validation");
      if (["initializing", "ambiguous"].includes(session.state)) {
        await postgres.query("update tiktok_publish_sessions set state = 'ambiguous', updated_at = now() where id = $1", [session.id]);
        return fail(id, "initialization_outcome_unknown", "ambiguous");
      }
      if (session.state === "failed") return fail(id, session.error_code || "previous_attempt_rejected", "validation");
      if (row.transmission_status === "canceled") return { status: "canceled" };
      if (new Date(session.media_expires_at).getTime() < Date.now() + 3_600_000) return fail(id, "prepared_media_expired", "validation");
      let token, info;
      try { token = await tokenFor(row); info = await eligible(row, token, session.duration_ms); }
      catch (error) {
        if (["rate_limit", "transient"].includes(error.category)) return { status: "retry", delay: 60_000 };
        return fail(id, error.code || error.message, error.category || "auth");
      }
      // Commit the intent BEFORE the non-idempotent API call. No retry is allowed
      // to cross this boundary unless TikTok explicitly rejected initialization.
      const claimed = await postgres.query(`update tiktok_publish_sessions set state = 'initializing', creator_username = $2,
        updated_at = now() where id = $1 and state = 'prepared' returning id`, [session.id, info.creator_username]);
      if (!claimed.rows.length) return { status: "retry", delay: 10_000 };
      const attempt = await postgres.query(`update projections set status = 'publishing', attempt_count = attempt_count + 1,
        error_category = null, error_summary = null, updated_at = now() where id = $1 returning attempt_count`, [id]);
      await postgres.query(`insert into publish_attempts (projection_id, attempt_number, status) values ($1, $2, 'started')
        on conflict (projection_id, attempt_number) do nothing`, [id, attempt.rows[0].attempt_count]);
      let publishId;
      try { publishId = await initDirect(token, row.platform_options, row.caption, tiktokMediaUrl(session.id, session.media_expires_at, environment)); }
      catch (error) {
        const ambiguous = error.ambiguous !== false;
        const canRetry = !ambiguous && ["auth", "rate_limit"].includes(error.category);
        await postgres.query(`update tiktok_publish_sessions set state = $2, error_code = $3, updated_at = now() where id = $1`,
          [session.id, ambiguous ? "ambiguous" : canRetry ? "prepared" : "failed", error.code || "initialization_outcome_unknown"]);
        if (canRetry && error.category === "rate_limit") {
          await postgres.query("update publish_attempts set status = 'retrying', completed_at = now() where projection_id = $1 and status = 'started'", [id]);
          await postgres.query("update projections set status = 'retrying', error_category = 'rate_limit', error_summary = 'TikTok rate limit; retrying the rejected request.', updated_at = now() where id = $1", [id]);
          return { status: "retry", delay: 60_000 };
        }
        return fail(id, error.code || "initialization_outcome_unknown", ambiguous ? "ambiguous" : error.category);
      }
      // Do not wrap this write in the API-error handler: a lost DB acknowledgement
      // must never reset an accepted initialization to 'prepared'.
      await postgres.query(`update tiktok_publish_sessions set publish_id = $2, state = 'processing', error_code = null,
        updated_at = now() where id = $1`, [session.id, publishId]);
      await postgres.query(`update projections set status = 'processing', pending_container_id = $2, updated_at = now() where id = $1`, [id, publishId]);
      await postgres.query(`insert into events (workspace_id, transmission_id, projection_id, type, message)
        values ($1, $2, $3, 'projection.processing', 'TikTok is processing the video. It may take a few minutes to appear.')`, [row.workspace_id, row.transmission_id, id]);
      return { status: "processing" };
    },

    async pollTikTokDirect(id) {
      const row = await context(id);
      const session = await sessionFor(id);
      if (!session?.publish_id) return fail(id, "missing_publish_id", "ambiguous");
      if (session.state === "complete") return { status: "live" };
      let result;
      try { result = await fetchStatus(await tokenFor(row), session.publish_id); }
      catch (error) {
        if (error.category === "auth") return fail(id, error.code || "authorization_expired", "auth");
        if (["validation", "config", "posting_restricted"].includes(error.category)) return fail(id, error.code || "status_request_rejected", error.category);
        return { status: "processing", delay: 60_000 };
      }
      if (result.status === "PUBLISH_COMPLETE") return complete(row, session, result);
      await postgres.query("update tiktok_publish_sessions set last_platform_status = $2, updated_at = now() where id = $1", [session.id, result.status]);
      if (result.status === "FAILED") {
        await postgres.query("update tiktok_publish_sessions set state = 'failed', error_code = $2 where id = $1", [session.id, result.fail_reason || "media_rejected"]);
        return fail(id, result.fail_reason || "media_rejected", "validation");
      }
      return { status: "processing" };
    },

    async failTikTokDirect(id, code = "publishing_interrupted", category = "platform") {
      return fail(id, code, category);
    },

    async refreshTikTokPublicIds(accountId) {
      const { rows } = await postgres.query(`select p.id from projections p join tiktok_publish_sessions s on s.projection_id = p.id
        where p.social_account_id = $1 and s.state = 'complete' and p.platform_post_id is null
          and p.platform_options->>'privacyLevel' <> 'SELF_ONLY' and s.created_at > now() - interval '7 days'
        order by s.created_at desc limit 20`, [accountId]);
      for (const item of rows) {
        const row = await context(item.id);
        const session = await sessionFor(item.id);
        const result = await fetchStatus(await tokenFor(row), session.publish_id);
        if (result.status === "PUBLISH_COMPLETE") await complete(row, session, result);
      }
    },
  };
}
