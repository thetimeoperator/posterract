/**
 * TikTok connector — Login Kit (web) + Content Posting API draft upload.
 * Pure fetch helpers; called from Convex actions. Endpoints verified against
 * developers.tiktok.com (July 2026):
 *  - authorize: https://www.tiktok.com/v2/auth/authorize/
 *  - token:     POST https://open.tiktokapis.com/v2/oauth/token/ (form-encoded;
 *               access_token lives 24h, refresh_token 365d and ROTATES on refresh)
 *  - upload:    inbox/video/init (FILE_UPLOAD) → PUT chunks → status/fetch
 *               poll (PROCESSING_* → SEND_TO_USER_INBOX | FAILED)
 * Chunk rules: 5–64 MB per chunk (final chunk may run to 128 MB); videos
 * ≤ 64 MB go as a single chunk; ≥ 4 GB unsupported.
 */

const OPEN_API = "https://open.tiktokapis.com";

/** Scopes approved for Posterract in the TikTok developer portal. */
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
  "user.info.stats",
  "video.list",
] as const;

export function tiktokAuthUrl(args: { clientKey: string; redirectUri: string; state: string }): string {
  const p = new URLSearchParams({
    client_key: args.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: args.redirectUri,
    state: args.state,
    // TikTok otherwise skips its authorization screen when the browser still
    // has a valid TikTok session and this app was approved previously. Always
    // show consent so users can verify or change the account being connected.
    disable_auto_auth: "1",
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
  avatarUrl?: string;
  scopes: string[];
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
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
    scopes: json.scope?.split(",").map((scope) => scope.trim()).filter(Boolean) ?? [...TIKTOK_SCOPES],
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

  const infoRes = await fetch(`${OPEN_API}/v2/user/info/?fields=open_id,display_name,avatar_url`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const info = (await infoRes.json()) as {
    data?: { user?: { display_name?: string; open_id?: string; avatar_url?: string } };
    error?: { code?: string; message?: string };
  };
  return {
    ...tokens,
    displayName: info.data?.user?.display_name ?? "TikTok",
    avatarUrl: info.data?.user?.avatar_url,
  };
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

/** Revoke the user's TikTok grant before discarding Posterract's token copy. */
export async function tiktokRevokeToken(args: {
  clientKey: string;
  clientSecret: string;
  accessToken: string;
}): Promise<void> {
  const response = await fetch(`${OPEN_API}/v2/oauth/revoke/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: args.clientKey,
      client_secret: args.clientSecret,
      token: args.accessToken,
    }),
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
  };
  throw new Error(
    `TikTok revoke failed: ${body.error_description ?? body.error ?? response.status}`,
  );
}

export type TikTokUserStats = {
  followers: number;
  following: number;
  totalLikes: number;
  videos: number;
};

export async function tiktokGetUserStats(accessToken: string): Promise<TikTokUserStats> {
  const fields = "follower_count,following_count,likes_count,video_count";
  const response = await fetch(`${OPEN_API}/v2/user/info/?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await response.json()) as TikTokEnvelope<{
    user?: {
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  }>;
  if (!response.ok || (json.error?.code && json.error.code !== "ok")) {
    throw new Error(`TikTok user analytics failed: ${json.error?.code ?? response.status}`);
  }
  const user = json.data?.user;
  return {
    followers: user?.follower_count ?? 0,
    following: user?.following_count ?? 0,
    totalLikes: user?.likes_count ?? 0,
    videos: user?.video_count ?? 0,
  };
}

export type TikTokVideoStats = {
  id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  durationSeconds?: number;
  createdAt?: number;
};

export async function tiktokGetVideoStats(
  accessToken: string,
  videoIds: string[],
): Promise<TikTokVideoStats[]> {
  if (videoIds.length === 0) return [];
  const fields = "id,view_count,like_count,comment_count,share_count,duration,create_time";
  const data = await openApiPost<{
    videos?: Array<{
      id?: string;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
      duration?: number;
      create_time?: number;
    }>;
  }>(`/v2/video/query/?fields=${fields}`, accessToken, { filters: { video_ids: videoIds.slice(0, 20) } });
  return (data.videos ?? []).flatMap((video) =>
    video.id
      ? [{
          id: video.id,
          views: video.view_count ?? 0,
          likes: video.like_count ?? 0,
          comments: video.comment_count ?? 0,
          shares: video.share_count ?? 0,
          durationSeconds: video.duration,
          createdAt: video.create_time,
        }]
      : [],
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
    // Keep the machine-readable code — messages are often generic boilerplate.
    throw new Error(`TikTok ${path} failed: ${json.error.code} — ${json.error.message ?? "no message"}`);
  }
  if (!json.data) throw new Error(`TikTok ${path} failed: empty response (${res.status})`);
  return json.data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PublishProgress = (stage: string, detail?: string) => Promise<void> | void;

const SINGLE_CHUNK_MAX = 64_000_000;
const CHUNK_SIZE = 50_000_000;

/**
 * Upload a video draft to the creator's TikTok inbox. TikTok then asks the
 * creator to review/edit the video and finish publishing in the TikTok app.
 * Resume: pass the publish_id from a previous attempt to skip re-uploading
 * and go straight to polling.
 */
export async function tiktokUploadVideoDraft(args: {
  accessToken: string;
  videoUrl: string;
  mimeType?: string;
  /** Known object size lets the worker stream upload ranges without buffering the whole video. */
  sizeBytes?: number;
  resumePublishId?: string;
  onPublishId?: (publishId: string) => Promise<void> | void;
  onProgress?: PublishProgress;
}): Promise<{ publishId: string; inboxDelivered: boolean; postId?: string }> {
  const { accessToken, videoUrl } = args;

  const initAndUpload = async (): Promise<string> => {
    // 1. Resolve the size. VPS workers pass sizeBytes from PostgreSQL, which
    // avoids buffering a multi-gigabyte video in memory. The fallback keeps
    // the existing Convex call path compatible during the cutover window.
    await args.onProgress?.("uploading", "Preparing TikTok draft");
    let bufferedVideo: ArrayBuffer | undefined;
    let size = args.sizeBytes;
    if (!size) {
      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) throw new Error(`Video fetch failed: ${videoRes.status}`);
      bufferedVideo = await videoRes.arrayBuffer();
      size = bufferedVideo.byteLength;
    }

    // 2. Initialize a draft upload. This endpoint requires video.upload and
    // deliberately does not accept Direct Post's post_info payload.
    const single = size <= SINGLE_CHUNK_MAX;
    // TikTok defines total_chunk_count as floor(video_size / chunk_size),
    // with every trailing byte merged into the final chunk. Keep at least two
    // chunks for videos above the 64 MB whole-upload limit; using ceil here
    // makes TikTok reject files whose size is not an exact chunk multiple.
    const chunkSize = single ? size : Math.min(CHUNK_SIZE, Math.floor(size / 2));
    const chunkCount = single ? 1 : Math.floor(size / chunkSize);
    const init = await openApiPost<{ publish_id?: string; upload_url?: string }>(
      "/v2/post/publish/inbox/video/init/",
      accessToken,
      {
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

    // 3. PUT chunk(s) — 206 per partial chunk, 201 when complete.
    await args.onProgress?.("uploading", "Uploading draft to TikTok");
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = i === chunkCount - 1 ? size - 1 : start + chunkSize - 1;
      const chunk = bufferedVideo
        ? bufferedVideo.slice(start, end + 1)
        : await (async () => {
            const response = await fetch(videoUrl, {
              headers: { Range: `bytes=${start}-${end}` },
            });
            if (!response.ok) {
              throw new Error(`Video range fetch failed: ${response.status}`);
            }
            return response.arrayBuffer();
          })();
      const put = await fetch(init.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": args.mimeType ?? "video/mp4",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
        },
        body: chunk,
      });
      if (!put.ok) throw new Error(`TikTok chunk upload failed: ${put.status}`);
    }
    return init.publish_id;
  };

  let resumed = Boolean(args.resumePublishId);
  let publishId = args.resumePublishId ?? (await initAndUpload());

  // 4. Stop as soon as TikTok confirms that the draft reached the creator's
  // inbox. PUBLISH_COMPLETE is also possible if the creator finishes the
  // TikTok editing flow while this request is still polling.
  await args.onProgress?.("processing", "Delivering draft to the TikTok inbox");
  const deadline = Date.now() + 150_000;
  for (;;) {
    await sleep(4000);
    const status = await openApiPost<{
      status?: string;
      fail_reason?: string;
      publicaly_available_post_id?: number[];
    }>("/v2/post/publish/status/fetch/", accessToken, { publish_id: publishId });

    if (status.status === "PUBLISH_COMPLETE") {
      return {
        publishId,
        inboxDelivered: true,
        postId: status.publicaly_available_post_id?.[0]?.toString(),
      };
    }
    if (status.status === "SEND_TO_USER_INBOX") {
      return { publishId, inboxDelivered: true };
    }
    // A resumed FILE_UPLOAD still in PROCESSING_UPLOAD means the prior
    // attempt died mid-transfer — its upload_url is gone, so the publish can
    // never complete. Start a fresh one.
    if (resumed && status.status === "PROCESSING_UPLOAD") {
      resumed = false;
      publishId = await initAndUpload();
      continue;
    }
    if (status.status === "FAILED") {
      // A resumed publish may have died between attempts — start fresh once.
      if (resumed) {
        resumed = false;
        publishId = await initAndUpload();
        continue;
      }
      throw new Error(`TikTok draft upload failed: ${status.fail_reason ?? "unknown"}`);
    }
    if (Date.now() > deadline) {
      const err = new Error("TikTok draft is still processing — will retry") as Error & { retryable?: boolean };
      err.retryable = true;
      throw err;
    }
  }
}
