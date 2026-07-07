/**
 * Instagram connector — "Instagram API with Instagram Login" variant
 * (graph.instagram.com). Pure fetch helpers; called from Convex actions.
 * Endpoints verified against Meta docs (see docs/instagram-api.md).
 */

const API_VERSION = "v23.0";
const GRAPH = `https://graph.instagram.com`;

export const IG_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export function instagramAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const p = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: IG_SCOPES.join(","),
    state: args.state,
  });
  return `https://www.instagram.com/oauth/authorize?${p.toString()}`;
}

export type IgToken = {
  accessToken: string;
  userId: string;
  username: string;
  expiresAt: number;
};

/** code → short-lived token → long-lived token → profile. */
export async function instagramExchangeCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<IgToken> {
  // 1. short-lived token
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
      // Instagram strips a trailing "#_" from the returned code in some flows.
      code: args.code.replace(/#_$/, ""),
    }),
  });
  const shortJson = (await shortRes.json()) as {
    access_token?: string;
    user_id?: number | string;
    error_message?: string;
    error_type?: string;
  };
  if (!shortRes.ok || !shortJson.access_token) {
    throw new Error(`Instagram token exchange failed: ${shortJson.error_message ?? shortRes.status}`);
  }

  // 2. long-lived token (60 days)
  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", args.clientSecret);
  longUrl.searchParams.set("access_token", shortJson.access_token);
  const longRes = await fetch(longUrl);
  const longJson = (await longRes.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  // A short-lived fallback would die in ~1h while claiming 60 days — fail loudly instead.
  if (!longRes.ok || !longJson.access_token) {
    throw new Error(
      `Instagram long-lived token exchange failed: ${longJson.error?.message ?? longRes.status}`,
    );
  }
  const accessToken = longJson.access_token;
  const expiresAt = Date.now() + (longJson.expires_in ?? 60 * 86400) * 1000;

  // 3. profile
  const profileUrl = new URL(`${GRAPH}/me`);
  profileUrl.searchParams.set("fields", "user_id,username");
  profileUrl.searchParams.set("access_token", accessToken);
  const profileRes = await fetch(profileUrl);
  const profile = (await profileRes.json()) as {
    user_id?: string;
    username?: string;
    error?: { message?: string };
  };
  const userId = profile.user_id ?? String(shortJson.user_id ?? "");
  if (!userId) throw new Error(`Instagram profile lookup failed: ${profile.error?.message ?? "no user id"}`);

  return { accessToken, userId, username: profile.username ?? "instagram", expiresAt };
}

/** Refresh a long-lived token (extends another 60 days). */
export async function instagramRefreshToken(accessToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const res = await fetch(url);
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`Instagram token refresh failed: ${json.error?.message ?? res.status}`);
  }
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 60 * 86400) * 1000,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PublishProgress = (stage: string, detail?: string) => Promise<void> | void;

/** Create container → poll until FINISHED → publish → return media id + permalink. */
export async function instagramPublishReel(args: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
  /** Container from a previous attempt — resume polling it instead of re-uploading. */
  resumeContainerId?: string;
  /** Fired when a container is created, so the caller can persist it for resume. */
  onContainer?: (containerId: string) => Promise<void> | void;
  onProgress?: PublishProgress;
}): Promise<{ mediaId: string; permalink?: string }> {
  const { igUserId, accessToken, videoUrl, caption } = args;

  // 1. container (skipped when resuming one that is still transcoding)
  const createContainer = async (): Promise<string> => {
    await args.onProgress?.("uploading", "Creating Instagram media container");
    const containerRes = await fetch(`${GRAPH}/${API_VERSION}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_type: "REELS", video_url: videoUrl, caption, access_token: accessToken }),
    });
    const container = (await containerRes.json()) as { id?: string; error?: { message?: string } };
    if (!containerRes.ok || !container.id) {
      throw new Error(`IG container failed: ${container.error?.message ?? containerRes.status}`);
    }
    await args.onContainer?.(container.id);
    return container.id;
  };
  let resumed = Boolean(args.resumeContainerId);
  let containerId = args.resumeContainerId ?? (await createContainer());

  // 2. poll status (Reels transcode — up to ~2.5 min per attempt, then defer via retryable error)
  await args.onProgress?.("processing", "Instagram is processing the Reel");
  const deadline = Date.now() + 150_000;
  for (;;) {
    await sleep(4000);
    const statusUrl = new URL(`${GRAPH}/${API_VERSION}/${containerId}`);
    statusUrl.searchParams.set("fields", "status_code");
    statusUrl.searchParams.set("access_token", accessToken);
    const s = (await (await fetch(statusUrl)).json()) as { status_code?: string };
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      // A resumed container may have died between attempts — start a fresh one once.
      if (resumed) {
        resumed = false;
        containerId = await createContainer();
        continue;
      }
      throw new Error(`IG processing ${s.status_code}`);
    }
    if (Date.now() > deadline) {
      const err = new Error("IG still processing — will retry") as Error & { retryable?: boolean };
      err.retryable = true;
      throw err;
    }
  }

  // 3. publish
  await args.onProgress?.("publishing", "Publishing to Instagram");
  const publishRes = await fetch(`${GRAPH}/${API_VERSION}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
  });
  const published = (await publishRes.json()) as { id?: string; error?: { message?: string } };
  if (!publishRes.ok || !published.id) {
    throw new Error(`IG publish failed: ${published.error?.message ?? publishRes.status}`);
  }

  // permalink (best-effort)
  let permalink: string | undefined;
  try {
    const permUrl = new URL(`${GRAPH}/${API_VERSION}/${published.id}`);
    permUrl.searchParams.set("fields", "permalink");
    permUrl.searchParams.set("access_token", accessToken);
    const perm = (await (await fetch(permUrl)).json()) as { permalink?: string };
    permalink = perm.permalink;
  } catch {
    /* non-fatal */
  }

  return { mediaId: published.id, permalink };
}
