const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannelResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: {
      viewCount?: string;
      subscriberCount?: string;
      hiddenSubscriberCount?: boolean;
      videoCount?: string;
    };
  }>;
  error?: { message?: string };
};

function googleError(body: GoogleTokenResponse, fallback: string): Error {
  return new Error(body.error_description || body.error || fallback);
}

export function youtubeAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state: args.state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function youtubeExchangeCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      code: args.code,
      grant_type: "authorization_code",
    }),
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) throw googleError(body, "Google token exchange failed");
  if (!body.refresh_token) {
    throw new Error("Google did not grant offline YouTube access — revoke Posterract and reconnect");
  }

  const channel = await youtubeGetMyChannel(body.access_token);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scopes: body.scope?.split(" ").filter(Boolean) ?? [...YOUTUBE_SCOPES],
    channelId: channel.id,
    channelTitle: channel.title,
    handle: channel.handle,
  };
}

export async function youtubeRefreshToken(args: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) throw googleError(body, "Google token refresh failed");
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    scopes: body.scope?.split(" ").filter(Boolean),
  };
}

export async function youtubeRevokeToken(token: string): Promise<void> {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  // Google returns 400 when the token was already invalidated; local cleanup
  // should still proceed in that case.
  if (!response.ok && response.status !== 400) throw new Error("Google token revocation failed");
}

export async function youtubeGetMyChannel(accessToken: string) {
  const response = await fetch(`${YOUTUBE_API}/channels?part=id%2Csnippet%2Cstatistics&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as YouTubeChannelResponse;
  if (!response.ok) throw new Error(body.error?.message || "Could not read the YouTube channel");
  const channel = body.items?.[0];
  if (!channel) throw new Error("This Google account does not have a YouTube channel");
  return {
    id: channel.id,
    title: channel.snippet?.title || "YouTube channel",
    handle: channel.snippet?.customUrl,
    statistics: {
      views: Number(channel.statistics?.viewCount ?? 0),
      subscribers: channel.statistics?.hiddenSubscriberCount
        ? undefined
        : Number(channel.statistics?.subscriberCount ?? 0),
      videos: Number(channel.statistics?.videoCount ?? 0),
    },
  };
}

export type YouTubePrivacy = "public" | "unlisted" | "private";

export type YouTubeUploadMetadata = {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacy;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  notifySubscribers: boolean;
  categoryId?: string;
};

export async function youtubeStartResumableUpload(args: {
  accessToken: string;
  mimeType: string;
  totalBytes: number;
  metadata: YouTubeUploadMetadata;
}): Promise<string> {
  const params = new URLSearchParams({
    uploadType: "resumable",
    part: "snippet,status",
    notifySubscribers: String(args.metadata.notifySubscribers),
  });
  const response = await fetch(`${YOUTUBE_UPLOAD_API}/videos?${params}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(args.totalBytes),
      "x-upload-content-type": args.mimeType,
    },
    body: JSON.stringify({
      snippet: {
        title: args.metadata.title,
        description: args.metadata.description,
        categoryId: args.metadata.categoryId || "22",
      },
      status: {
        privacyStatus: args.metadata.privacyStatus,
        selfDeclaredMadeForKids: args.metadata.madeForKids,
        containsSyntheticMedia: args.metadata.containsSyntheticMedia,
      },
    }),
  });
  if (!response.ok) throw await youtubeApiError(response, "Could not start the YouTube upload");
  const uploadUrl = response.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL");
  return uploadUrl;
}

type UploadResult = { id?: string; status?: { privacyStatus?: string; uploadStatus?: string } };

async function youtubeApiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    | null;
  const error = new Error(body?.error?.message || `${fallback} (${response.status})`) as Error & {
    retryable?: boolean;
    reason?: string;
    status?: number;
  };
  error.retryable = [429, 500, 502, 503, 504].includes(response.status);
  error.reason = body?.error?.errors?.[0]?.reason;
  error.status = response.status;
  return error;
}

function nextOffsetFromRange(range: string | null, fallback: number): number {
  const match = range?.match(/bytes=0-(\d+)/);
  return match ? Number(match[1]) + 1 : fallback;
}

async function queryUploadOffset(uploadUrl: string, totalBytes: number, accessToken: string): Promise<{
  offset: number;
  result?: UploadResult;
}> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-range": `bytes */${totalBytes}`,
      "content-length": "0",
    },
  });
  if (response.status === 308) {
    return { offset: nextOffsetFromRange(response.headers.get("range"), 0) };
  }
  if (response.ok) return { offset: totalBytes, result: (await response.json()) as UploadResult };
  throw await youtubeApiError(response, "Could not resume the YouTube upload");
}

async function* fixedChunks(
  body: ReadableStream<Uint8Array>,
  skipBytes: number,
  chunkSize: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let skip = skipBytes;
  let buffer = new Uint8Array(chunkSize);
  let filled = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let incoming = value;
      if (skip > 0) {
        const skipped = Math.min(skip, incoming.byteLength);
        incoming = incoming.slice(skipped);
        skip -= skipped;
        if (incoming.byteLength === 0) continue;
      }
      while (incoming.byteLength > 0) {
        const take = Math.min(chunkSize - filled, incoming.byteLength);
        buffer.set(incoming.subarray(0, take), filled);
        filled += take;
        incoming = incoming.subarray(take);
        if (filled === chunkSize) {
          yield buffer;
          buffer = new Uint8Array(chunkSize);
          filled = 0;
        }
      }
    }
    if (filled) yield buffer.slice(0, filled);
  } finally {
    reader.releaseLock();
  }
}

/** Uploads in 8 MiB chunks (a multiple of YouTube's required 256 KiB). */
export async function youtubeUploadResumable(args: {
  accessToken: string;
  uploadUrl: string;
  videoUrl: string;
  totalBytes: number;
  mimeType: string;
  startingOffset?: number;
  onProgress?: (uploadedBytes: number) => Promise<void>;
}): Promise<{ videoId: string; privacyStatus?: string }> {
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  let failures = 0;

  // The persisted offset is only a signal that this is a resumed session.
  // YouTube is authoritative: the previous request may have reached Google
  // even if our progress mutation did not complete.
  if (args.startingOffset !== undefined) {
    const status = await queryUploadOffset(args.uploadUrl, args.totalBytes, args.accessToken);
    if (status.result?.id) {
      return { videoId: status.result.id, privacyStatus: status.result.status?.privacyStatus };
    }
    offset = status.offset;
    await args.onProgress?.(offset);
  }

  while (offset < args.totalBytes) {
    const source = await fetch(args.videoUrl, {
      headers: offset > 0 ? { range: `bytes=${offset}-` } : undefined,
    });
    if (!source.ok || !source.body) throw new Error("Video is not available to upload");
    try {
      const skipBytes = source.status === 206 ? 0 : offset;
      for await (const chunk of fixedChunks(source.body, skipBytes, chunkSize)) {
        const end = offset + chunk.byteLength - 1;
        const response = await fetch(args.uploadUrl, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${args.accessToken}`,
            "content-type": args.mimeType,
            "content-length": String(chunk.byteLength),
            "content-range": `bytes ${offset}-${end}/${args.totalBytes}`,
          },
          body: Uint8Array.from(chunk).buffer,
        });
        if (response.status === 308) {
          offset = nextOffsetFromRange(response.headers.get("range"), end + 1);
          failures = 0;
          await args.onProgress?.(offset);
          continue;
        }
        if (response.ok) {
          const result = (await response.json()) as UploadResult;
          if (!result.id) throw new Error("YouTube accepted the upload without returning a video id");
          await args.onProgress?.(args.totalBytes);
          return { videoId: result.id, privacyStatus: result.status?.privacyStatus };
        }
        throw await youtubeApiError(response, "YouTube upload failed");
      }
    } catch (error) {
      const retryable = (error as { retryable?: boolean }).retryable === true || error instanceof TypeError;
      if (!retryable || failures >= 5) throw error;
      failures += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(32_000, 1000 * 2 ** failures)));
      const status = await queryUploadOffset(args.uploadUrl, args.totalBytes, args.accessToken);
      if (status.result?.id) {
        return { videoId: status.result.id, privacyStatus: status.result.status?.privacyStatus };
      }
      offset = status.offset;
    }
  }
  const status = await queryUploadOffset(args.uploadUrl, args.totalBytes, args.accessToken);
  if (!status.result?.id) throw new Error("YouTube upload did not complete");
  return { videoId: status.result.id, privacyStatus: status.result.status?.privacyStatus };
}

export async function youtubeGetVideo(accessToken: string, videoId: string) {
  const params = new URLSearchParams({ part: "status,processingDetails,statistics", id: videoId });
  const response = await fetch(`${YOUTUBE_API}/videos?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as {
    items?: Array<{
      id: string;
      status?: { privacyStatus?: string; uploadStatus?: string };
      processingDetails?: { processingStatus?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  };
  if (!response.ok) throw await youtubeApiError(response, "Could not read the YouTube video");
  return body.items?.[0] ?? null;
}

export async function youtubeGetVideos(accessToken: string, videoIds: string[]) {
  if (videoIds.length === 0) return [];
  const params = new URLSearchParams({
    part: "statistics",
    id: videoIds.slice(0, 50).join(","),
  });
  const response = await fetch(`${YOUTUBE_API}/videos?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json()) as {
    items?: Array<{
      id: string;
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
  };
  if (!response.ok) throw await youtubeApiError(response, "Could not read YouTube video statistics");
  return body.items ?? [];
}

type AnalyticsCell = string | number | null;
type YouTubeAnalyticsResponse = {
  columnHeaders?: Array<{ name?: string }>;
  rows?: AnalyticsCell[][];
};

function analyticsRows(body: YouTubeAnalyticsResponse): Array<Record<string, AnalyticsCell>> {
  const names = body.columnHeaders?.map((header) => header.name ?? "") ?? [];
  return (body.rows ?? []).map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index] ?? 0])),
  );
}

const metricNumber = (row: Record<string, AnalyticsCell>, key: string) => Number(row[key] ?? 0);

export async function youtubeAnalyticsReport(args: {
  accessToken: string;
  videoId: string;
  startDate: string;
  endDate: string;
}) {
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    metrics:
      "views,engagedViews,likes,comments,shares,estimatedMinutesWatched,averageViewDuration",
    filters: `video==${args.videoId}`,
  });
  const response = await fetch(`${YOUTUBE_ANALYTICS_API}?${params}`, {
    headers: { authorization: `Bearer ${args.accessToken}` },
  });
  const body = (await response.json()) as YouTubeAnalyticsResponse;
  if (!response.ok) throw await youtubeApiError(response, "Could not read YouTube Analytics");
  const row = analyticsRows(body)[0] ?? {};
  return {
    views: metricNumber(row, "views"),
    engagedViews: metricNumber(row, "engagedViews"),
    likes: metricNumber(row, "likes"),
    comments: metricNumber(row, "comments"),
    shares: metricNumber(row, "shares"),
    estimatedMinutesWatched: metricNumber(row, "estimatedMinutesWatched"),
    averageViewDuration: metricNumber(row, "averageViewDuration"),
  };
}

/** Channel-owned daily history for the Echoes trend and audience-growth views. */
export async function youtubeChannelAnalyticsReport(args: {
  accessToken: string;
  startDate: string;
  endDate: string;
}) {
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: "day",
    metrics:
      "views,engagedViews,likes,comments,shares,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
    sort: "day",
  });
  const response = await fetch(`${YOUTUBE_ANALYTICS_API}?${params}`, {
    headers: { authorization: `Bearer ${args.accessToken}` },
  });
  const body = (await response.json()) as YouTubeAnalyticsResponse;
  if (!response.ok) throw await youtubeApiError(response, "Could not read YouTube channel analytics");
  return analyticsRows(body).map((row) => ({
    date: String(row.day ?? ""),
    views: metricNumber(row, "views"),
    engagedViews: metricNumber(row, "engagedViews"),
    likes: metricNumber(row, "likes"),
    comments: metricNumber(row, "comments"),
    shares: metricNumber(row, "shares"),
    estimatedMinutesWatched: metricNumber(row, "estimatedMinutesWatched"),
    averageViewDuration: metricNumber(row, "averageViewDuration"),
    subscribersGained: metricNumber(row, "subscribersGained"),
    subscribersLost: metricNumber(row, "subscribersLost"),
  }));
}
