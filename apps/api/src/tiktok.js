import { defaultTikTokPrivacy, validateTikTokOptions } from "@posterract/contract/tiktok";
import { freshProfileAccessToken } from "./oauth.js";
import { tiktokCreatorInfo, tiktokFailureMessage } from "../../web/convex/connectors/tiktokDirect.ts";

const TIKTOK_ACCOUNTS = `select a.*, tok.access_token_ciphertext, tok.refresh_token_ciphertext,
  coalesce(tok.access_token_expires_at, a.token_expires_at) as access_token_expires_at
  from social_accounts a left join social_account_tokens tok on tok.social_account_id = a.id
  where a.id = any($1::uuid[]) and a.workspace_id = $2 and a.provider = 'tiktok'`;

const RECONNECT = "Reconnect this TikTok account in Social accounts.";

/** A failed creator_info call, as the reply the creator or agent reads. */
function creatorInfoProblem(error) {
  const code = error.code || "creator_info_unavailable";
  const detail = tiktokFailureMessage(code) ?? (error.category === "auth" ? `TikTok authorization needs attention. ${RECONNECT}`
    : error.category === "rate_limit" ? "TikTok is limiting new posts or requests for this account. Try again later."
      : `TikTok creator settings are unavailable (${code}). Try again or check the account in TikTok.`);
  return { status: error.category === "rate_limit" ? 429 : 409, body: { error: code, detail } };
}

/**
 * Checks a Direct Post's settings against each chosen TikTok account's current
 * creator settings: the audiences it allows, the interactions it has turned
 * off and the longest video it may post. Create Post does this on screen; API
 * keys and agents get the same answer here, when the post is made, instead of
 * a failure at publish time. A post without an audience goes to Everyone (a
 * private account: the widest it allows), written into `options`. Returns
 * undefined when every account accepts it, otherwise `{ status, body }`.
 */
export async function checkTikTokDirectPost(postgres, { workspaceId, accountIds, mediaId, options },
  { creatorInfo = tiktokCreatorInfo, freshToken = freshProfileAccessToken } = {}) {
  const [{ rows: accounts }, { rows: media }] = await Promise.all([
    postgres.query(TIKTOK_ACCOUNTS, [accountIds, workspaceId]),
    postgres.query("select duration_ms from media_assets where id = $1 and workspace_id = $2", [mediaId, workspaceId]),
  ]);
  const durationMs = media[0]?.duration_ms ?? undefined;
  for (const account of accounts) {
    if (account.status !== "connected" || !account.access_token_ciphertext) {
      return { status: 409, body: { error: "account_not_connected", detail: RECONNECT, details: { provider: "tiktok", accountId: account.id } } };
    }
    let info;
    try { info = await creatorInfo(await freshToken(postgres, account)); }
    catch (error) { return creatorInfoProblem(error); }
    if (!options.privacyLevel) options.privacyLevel = defaultTikTokPrivacy(info.privacy_level_options);
    const reason = validateTikTokOptions(options, info, durationMs);
    if (reason) {
      return { status: 409, body: { error: "tiktok_settings_rejected", detail: reason,
        details: { provider: "tiktok", accountId: account.id, reason, privacyLevelOptions: info.privacy_level_options } } };
    }
  }
}

export function registerTikTokRoutes(app, { postgres, requireScope, requiredWorkspace,
  creatorInfo = tiktokCreatorInfo, freshToken = freshProfileAccessToken }) {
  app.get("/v1/accounts/:accountId/tiktok/creator-info", { preHandler: requireScope("accounts:read") }, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.accountId)) return reply.code(404).send({ error: "account_not_found" });
    const { rows } = await postgres.query(TIKTOK_ACCOUNTS, [[request.params.accountId], requiredWorkspace(request)]);
    const account = rows[0];
    if (!account) return reply.code(404).send({ error: "account_not_found" });
    if (account.status !== "connected" || !account.access_token_ciphertext) return reply.code(409).send({ error: "account_not_connected", detail: RECONNECT });
    try {
      const info = await creatorInfo(await freshToken(postgres, account));
      await postgres.query(`update social_accounts set display_name = $2, handle = coalesce(nullif($3, ''), handle),
        avatar_url = coalesce(nullif($4, ''), avatar_url), last_health_check_at = now() where id = $1`,
      [account.id, info.creator_nickname, info.creator_username, info.creator_avatar_url]);
      return reply.header("Cache-Control", "no-store").send(info);
    } catch (error) {
      const problem = creatorInfoProblem(error);
      return reply.code(problem.status).send(problem.body);
    }
  });
}
