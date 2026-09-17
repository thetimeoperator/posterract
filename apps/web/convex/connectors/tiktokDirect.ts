import type { TikTokCreatorInfo, TikTokPostOptions } from "../../../../packages/contract/src/tiktok";
import { tikTokPostInfo } from "../../../../packages/contract/src/tiktok";

/** Creator posting restrictions are terminal for this attempt, unlike request throttling. */
export function tiktokPostingRestrictionMessage(code: string): string | undefined {
  switch (code) {
    case "spam_risk_too_many_posts":
      return "TikTok’s daily posting limit has been reached for this account. This attempt has stopped. Please try again later.";
    case "reached_active_user_cap":
      return "TikTok’s daily active-creator limit has been reached for Posterract. This attempt has stopped. Please try again later.";
    case "spam_risk_user_banned_from_posting":
      return "TikTok is not allowing this account to publish. This attempt has stopped. Check the account in TikTok and try again later.";
  }
}

export class TikTokApiError extends Error {
  constructor(public code: string, public status: number, public ambiguous = false) {
    super(`TikTok: ${code}`);
  }
  get category() {
    if (tiktokPostingRestrictionMessage(this.code)) return "posting_restricted";
    if (/token|scope|unauthor|permission/.test(this.code) || this.status === 401) return "auth";
    if (/rate_limit/.test(this.code) || this.status === 429) return "rate_limit";
    if (/url_ownership|unaudited/.test(this.code)) return "config";
    if (this.ambiguous) return "ambiguous";
    return this.status >= 500 ? "transient" : "validation";
  }
}

/** Preserve TikTok's int64 video IDs before JSON.parse can round them. */
export function parseTikTokResponse(text: string) {
  return JSON.parse(text.replace(/("publicaly_available_post_id"\s*:\s*\[)([^\]]*)(\])/g,
    (_match, start, ids, end) => start + ids.replace(/(^|,)\s*(\d+)\s*(?=,|$)/g, '$1"$2"') + end));
}

async function call<T>(path: string, accessToken: string, body: unknown, initializing = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://open.tiktokapis.com/v2/post/publish/${path}/`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new TikTokApiError(initializing ? "initialization_outcome_unknown" : "connection_failed", 503, initializing);
  }
  let result;
  try { result = parseTikTokResponse(await response.text()); }
  catch { throw new TikTokApiError("invalid_platform_response", response.status, initializing); }
  if (!response.ok || result.error?.code !== "ok") {
    // Only a well-formed rejection confirms that no publish ID was allocated.
    throw new TikTokApiError(result.error?.code || `http_${response.status}`, response.status,
      initializing && (response.status >= 500 || !result.error?.code));
  }
  if (!result.data) throw new TikTokApiError("missing_platform_data", response.status, initializing);
  return result.data as T;
}

export async function tiktokCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
  const data = await call<TikTokCreatorInfo>("creator_info/query", accessToken, {});
  if (!Array.isArray(data.privacy_level_options) || !Number.isFinite(data.max_video_post_duration_sec) || data.max_video_post_duration_sec <= 0
    || [data.comment_disabled, data.duet_disabled, data.stitch_disabled].some((v) => typeof v !== "boolean")) {
    throw new TikTokApiError("invalid_creator_info", 502);
  }
  return {
    creator_avatar_url: data.creator_avatar_url || "", creator_username: data.creator_username || "",
    creator_nickname: data.creator_nickname || "", privacy_level_options: data.privacy_level_options,
    comment_disabled: data.comment_disabled, duet_disabled: data.duet_disabled, stitch_disabled: data.stitch_disabled,
    max_video_post_duration_sec: data.max_video_post_duration_sec,
  };
}

export async function tiktokInitDirect(accessToken: string, options: TikTokPostOptions, caption: string, videoUrl: string) {
  const data = await call<{ publish_id: string }>("video/init", accessToken, {
    post_info: tikTokPostInfo(options, caption), source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
  }, true);
  if (!data.publish_id) throw new TikTokApiError("missing_publish_id", 502, true);
  return data.publish_id;
}

export function tiktokDirectStatus(accessToken: string, publishId: string) {
  return call<{ status: string; fail_reason?: string; publicaly_available_post_id?: string[] }>("status/fetch", accessToken, { publish_id: publishId });
}
