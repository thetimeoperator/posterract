/**
 * TikTok connector — Login Kit (web) + Content Posting API Direct Post.
 * Pure fetch helpers; called from Convex actions. Endpoints verified against
 * developers.tiktok.com (July 2026):
 *  - authorize: https://www.tiktok.com/v2/auth/authorize/
 *  - token:     POST https://open.tiktokapis.com/v2/oauth/token/ (form-encoded;
 *               access_token lives 24h, refresh_token 365d and ROTATES on refresh)
 *  - publish:   creator_info/query → video/init (FILE_UPLOAD) → PUT chunks →
 *               status/fetch poll (PROCESSING_* → PUBLISH_COMPLETE | FAILED)
 * Chunk rules: 5–64 MB per chunk (final chunk may run to 128 MB); videos
 * ≤ 64 MB go as a single chunk; ≥ 4 GB unsupported.
 */

const OPEN_API = "https://open.tiktokapis.com";

/** video.list rides along for Echo points (Display API) — the app must have
 * Login Kit + Content Posting API + Display API products enabled. */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.list"];

export function tiktokAuthUrl(args: { clientKey: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    client_key: args.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${p.toString()}`;
}

export type TikTokToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  openId: string;
  displayName: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OPEN_API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  return (await res.json()) as TokenResponse;
}

function toTokenSet(json: TokenResponse): Omit<TikTokToken, "displayName"> {
  if (!json.access_token || !json.refresh_token || !json.open_id) {
    throw new Error(`TikTok token exchange failed: ${json.error_description ?? json.error ?? "no token"}`);
  }
  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + (json.expires_in ?? 86400) * 1000,
    refreshExpiresAt: now + (json.refresh_expires_in ?? 365 * 86400) * 1000,
    openId: json.open_id,
  };
}

/** code → token pair → display name. */
export async function tiktokExchangeCode(args: {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<TikTokToken> {
  const tokens = toTokenSet(
    await tokenRequest({
      client_key: args.clientKey,
      client_secret: args.clientSecret,
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
    }),
  );

  const infoRes = await fetch(`${OPEN_API}/v2/user/info/?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const info = (await infoRes.json()) as {
    data?: { user?: { display_name?: string; open_id?: string } };
    error?: { code?: string; message?: string };
  };
  return { ...tokens, displayName: info.data?.user?.display_name ?? "TikTok" };
}

/** Refresh the 24h access token. The refresh token ROTATES — persist both. */
export async function tiktokRefreshToken(args: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<Omit<TikTokToken, "displayName">> {
  return toTokenSet(
    await tokenRequest({
      client_key: args.clientKey,
      client_secret: args.clientSecret,
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
    }),
  );
}

type TikTokEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

async function openApiPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${OPEN_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as TikTokEnvelope<T>;
  if (json.error && json.error.code && json.error.code !== "ok") {
    throw new Error(`TikTok ${path} failed: ${json.error.message ?? json.error.code}`);
  }
  if (!json.data) throw new Error(`TikTok ${path} failed: empty response (${res.status})`);
  return json.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PublishProgress = (stage: string, detail?: string) => Promise<void> | void;

const SINGLE_CHUNK_MAX = 64_000_000;
const CHUNK_SIZE = 50_000_000;

/**
 * Direct-post a video: creator_info → init (FILE_UPLOAD) → PUT chunk(s) →
 * poll status. Resume: pass the publish_id from a previous attempt to skip
 * re-uploading and go straight to polling.
 */
export async function tiktokPublishVideo(args: {
  accessToken: string;
  videoUrl: string;
  caption: string;
  mimeType?: string;
  resumePublishId?: string;
  onPublishId?: (publishId: string) => Promise<void> | void;
  onProgress?: PublishProgress;
}): Promise<{ publishId: string; postId?: string }> {
  const { accessToken, videoUrl, caption } = args;

  const initAndUpload = async (): Promise<string> => {
    // 1. creator info — required pre-publish step; also surfaces privacy options.
    await args.onProgress?.("uploading", "Checking TikTok creator status");
    const creator = await openApiPost<{ privacy_level_options?: string[]; creator_nickname?: string }>(
      "/v2/post/publish/creator_info/query/",
      accessToken,
      {},
    );
    // Unaudited clients may only post privately; post-audit this becomes the user's choice.
    const privacy = creator.privacy_level_options?.includes("SELF_ONLY")
      ? "SELF_ONLY"
      : (creator.privacy_level_options?.[0] ?? "SELF_ONLY");

    // 2. fetch the video bytes from storage
    await args.onProgress?.("uploading", "Preparing video for TikTok");
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Video fetch failed: ${videoRes.status}`);
    const bytes = await videoRes.arrayBuffer();
    const size = bytes.byteLength;

    // 3. init — single chunk ≤64MB, else 50MB chunks with the final one absorbing the remainder
    const single = size <= SINGLE_CHUNK_MAX;
    const chunkSize = single ? size : CHUNK_SIZE;
    const chunkCount = single ? 1 : Math.floor(size / chunkSize);
    const init = await openApiPost<{ publish_id?: string; upload_url?: string }>(
      "/v2/post/publish/video/init/",
      accessToken,
      {
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: chunkSize,
          total_chunk_count: chunkCount,
        },
      },
    );
    if (!init.publish_id || !init.upload_url) throw new Error("TikTok init returned no publish_id/upload_url");
    await args.onPublishId?.(init.publish_id);

    // 4. PUT chunk(s) — 206 per partial chunk, 201 when complete
    await args.onProgress?.("uploading", "Uploading video to TikTok");
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = i === chunkCount - 1 ? size - 1 : start + chunkSize - 1;
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": args.mimeType ?? "video/mp4",
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
        body: bytes.slice(start, end + 1),
      });
      if (!put.ok) throw new Error(`TikTok chunk upload failed: ${put.status}`);
    }
    return init.publish_id;
  };

  let resumed = Boolean(args.resumePublishId);
  let publishId = args.resumePublishId ?? (await initAndUpload());

  // 5. poll status (~2.5 min per attempt, then defer via retryable error)
  await args.onProgress?.("processing", "TikTok is processing the video");
  const deadline = Date.now() + 150_000;
  for (;;) {
    await sleep(4000);
    const status = await openApiPost<{
      status?: string;
      fail_reason?: string;
      publicaly_available_post_id?: number[];
    }>("/v2/post/publish/status/fetch/", accessToken, { publish_id: publishId });

    if (status.status === "PUBLISH_COMPLETE") {
      return { publishId, postId: status.publicaly_available_post_id?.[0]?.toString() };
    }
    if (status.status === "FAILED") {
      // A resumed publish may have died between attempts — start fresh once.
      if (resumed) {
        resumed = false;
        publishId = await initAndUpload();
        continue;
      }
      throw new Error(`TikTok publish failed: ${status.fail_reason ?? "unknown"}`);
    }
    if (Date.now() > deadline) {
      const err = new Error("TikTok still processing — will retry") as Error & { retryable?: boolean };
      err.retryable = true;
      throw err;
    }
  }
}
