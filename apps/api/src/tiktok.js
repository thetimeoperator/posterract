import { freshProfileAccessToken } from "./oauth.js";
import { tiktokCreatorInfo, tiktokPostingRestrictionMessage } from "../../web/convex/connectors/tiktokDirect.ts";

export function registerTikTokRoutes(app, { postgres, requireScope, requiredWorkspace,
  creatorInfo = tiktokCreatorInfo, freshToken = freshProfileAccessToken }) {
  app.get("/v1/accounts/:accountId/tiktok/creator-info", { preHandler: requireScope("accounts:read") }, async (request, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(request.params.accountId)) return reply.code(404).send({ error: "account_not_found" });
    const { rows } = await postgres.query(`select a.*, tok.access_token_ciphertext, tok.refresh_token_ciphertext,
      coalesce(tok.access_token_expires_at, a.token_expires_at) as access_token_expires_at
      from social_accounts a left join social_account_tokens tok on tok.social_account_id = a.id
      where a.id = $1 and a.workspace_id = $2 and a.provider = 'tiktok'`,
    [request.params.accountId, requiredWorkspace(request)]);
    const account = rows[0];
    if (!account) return reply.code(404).send({ error: "account_not_found" });
    if (account.status !== "connected" || !account.access_token_ciphertext) return reply.code(409).send({ error: "account_not_connected", detail: "Reconnect this TikTok account in Portals." });
    try {
      const info = await creatorInfo(await freshToken(postgres, account));
      await postgres.query(`update social_accounts set display_name = $2, handle = coalesce(nullif($3, ''), handle),
        avatar_url = coalesce(nullif($4, ''), avatar_url), last_health_check_at = now() where id = $1`,
      [account.id, info.creator_nickname, info.creator_username, info.creator_avatar_url]);
      return reply.header("Cache-Control", "no-store").send(info);
    } catch (error) {
      const code = error.code || "creator_info_unavailable";
      const detail = tiktokPostingRestrictionMessage(code) ?? (error.category === "auth" ? "TikTok authorization needs attention. Reconnect this account in Portals."
        : error.category === "rate_limit" ? "TikTok is limiting new posts or requests for this account. Try again later."
          : `TikTok creator settings are unavailable (${code}). Try again or check the account in TikTok.`);
      return reply.code(error.category === "rate_limit" ? 429 : 409).send({ error: code, detail });
    }
  });
}
