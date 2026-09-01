/** Official Threads API OAuth, publishing, and insights helpers. */

const API_VERSION = "v1.0";
const GRAPH = "https://graph.threads.net";

export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
];

export function threadsAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    scope: THREADS_SCOPES.join(","),
    response_type: "code",
    state: args.state,
  });
  return `https://threads.net/oauth/authorize?${params.toString()}`;
}

type ThreadsToken = {
  accessToken: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  expiresAt: number;
  scopes: string[];
};

export async function threadsExchangeCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<ThreadsToken> {
  const shortResponse = await fetch(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
      code: args.code.replace(/#_$/, ""),
    }),
  });
  const short = (await shortResponse.json()) as {
    access_token?: string;
    user_id?: string | number;
    error_message?: string;
    error?: { message?: string };
  };
  if (!shortResponse.ok || !short.access_token) {
    throw new Error(
      `Threads token exchange failed: ${short.error?.message ?? short.error_message ?? shortResponse.status}`,
    );
  }

  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set("grant_type", "th_exchange_token");
  longUrl.searchParams.set("client_secret", args.clientSecret);
  longUrl.searchParams.set("access_token", short.access_token);
  const longResponse = await fetch(longUrl);
  const long = (await longResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!longResponse.ok || !long.access_token) {
    throw new Error(`Threads long-lived token exchange failed: ${long.error?.message ?? longResponse.status}`);
  }

  const profileUrl = new URL(`${GRAPH}/${API_VERSION}/me`);
  profileUrl.searchParams.set("fields", "id,username,threads_profile_picture_url");
  profileUrl.searchParams.set("access_token", long.access_token);
  const profileResponse = await fetch(profileUrl);
  const profile = (await profileResponse.json()) as {
    id?: string;
    username?: string;
    threads_profile_picture_url?: string;
    error?: { message?: string };
  };
  const userId = profile.id ?? String(short.user_id ?? "");
  if (!profileResponse.ok || !userId) {
    throw new Error(`Threads profile lookup failed: ${profile.error?.message ?? profileResponse.status}`);
  }

  return {
    accessToken: long.access_token,
    userId,
    username: profile.username ?? "threads",
    avatarUrl: profile.threads_profile_picture_url,
    expiresAt: Date.now() + (long.expires_in ?? 60 * 86400) * 1000,
    scopes: THREADS_SCOPES,
  };
}

export async function threadsRefreshToken(
  accessToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const url = new URL(`${GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`Threads token refresh failed: ${body.error?.message ?? response.status}`);
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 60 * 86400) * 1000,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function threadsPublishVideo(args: {
  userId: string;
  accessToken: string;
  videoUrl: string;
  text: string;
  resumeContainerId?: string;
  onContainer?: (containerId: string) => Promise<void> | void;
  onProgress?: (stage: string, detail?: string) => Promise<void> | void;
}): Promise<{ mediaId: string; permalink?: string }> {
  let containerId = args.resumeContainerId;
  if (!containerId) {
    await args.onProgress?.("uploading", "Creating Threads video container");
    const response = await fetch(`${GRAPH}/${API_VERSION}/${args.userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        media_type: "VIDEO",
        video_url: args.videoUrl,
        text: args.text,
        access_token: args.accessToken,
      }),
    });
    const body = (await response.json()) as { id?: string; error?: { message?: string } };
    if (!response.ok || !body.id) {
      throw new Error(`Threads container failed: ${body.error?.message ?? response.status}`);
    }
    containerId = body.id;
    await args.onContainer?.(containerId);
  }

  await args.onProgress?.("processing", "Threads is processing the video");
  const deadline = Date.now() + 150_000;
  for (;;) {
    const statusUrl = new URL(`${GRAPH}/${API_VERSION}/${containerId}`);
    statusUrl.searchParams.set("fields", "status,error_message");
    statusUrl.searchParams.set("access_token", args.accessToken);
    const response = await fetch(statusUrl);
    const body = (await response.json()) as {
      status?: string;
      error_message?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(`Threads status failed: ${body.error?.message ?? response.status}`);
    }
    if (body.status === "FINISHED") break;
    if (body.status === "ERROR" || body.status === "EXPIRED") {
      throw new Error(`Threads processing failed: ${body.error_message ?? body.status}`);
    }
    if (Date.now() >= deadline) {
      const error = new Error("Threads is still processing — will retry") as Error & { retryable?: boolean };
      error.retryable = true;
      throw error;
    }
    await sleep(4000);
  }

  await args.onProgress?.("publishing", "Publishing to Threads");
  const publishResponse = await fetch(`${GRAPH}/${API_VERSION}/${args.userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: containerId,
      access_token: args.accessToken,
    }),
  });
  const published = (await publishResponse.json()) as { id?: string; error?: { message?: string } };
  if (!publishResponse.ok || !published.id) {
    throw new Error(`Threads publish failed: ${published.error?.message ?? publishResponse.status}`);
  }

  let permalink: string | undefined;
  try {
    const url = new URL(`${GRAPH}/${API_VERSION}/${published.id}`);
    url.searchParams.set("fields", "permalink");
    url.searchParams.set("access_token", args.accessToken);
    const response = await fetch(url);
    const body = (await response.json()) as { permalink?: string };
    permalink = body.permalink;
  } catch {
    // The post is already live; permalink lookup is best effort.
  }

  return { mediaId: published.id, permalink };
}

export async function threadsAccountInsights(args: {
  accessToken: string;
}): Promise<{
  audience?: number;
  totalViews?: number;
  totalLikes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  clicks?: number;
}> {
  const url = new URL(`${GRAPH}/${API_VERSION}/me/threads_insights`);
  url.searchParams.set("metric", "views,likes,replies,reposts,quotes,clicks,followers_count");
  url.searchParams.set("access_token", args.accessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    data?: Array<{ name?: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Threads insights failed: ${body.error?.message ?? response.status}`);
  const value = (name: string) => {
    const metric = body.data?.find((row) => row.name === name);
    return metric?.total_value?.value ?? metric?.values?.at(-1)?.value;
  };
  return {
    audience: value("followers_count"),
    totalViews: value("views"),
    totalLikes: value("likes"),
    replies: value("replies"),
    reposts: value("reposts"),
    quotes: value("quotes"),
    clicks: value("clicks"),
  };
}

export async function threadsPostInsights(args: {
  mediaId: string;
  accessToken: string;
}): Promise<{
  views: number;
  likes: number;
  comments: number;
  shares: number;
  replies: number;
  reposts: number;
  quotes: number;
}> {
  const url = new URL(`${GRAPH}/${API_VERSION}/${args.mediaId}/insights`);
  url.searchParams.set("metric", "views,likes,replies,reposts,quotes");
  url.searchParams.set("access_token", args.accessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    data?: Array<{ name?: string; values?: Array<{ value?: number }>; total_value?: { value?: number } }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Threads post insights failed: ${body.error?.message ?? response.status}`);
  const value = (name: string) => {
    const metric = body.data?.find((row) => row.name === name);
    return metric?.total_value?.value ?? metric?.values?.at(-1)?.value ?? 0;
  };
  return {
    views: value("views"),
    likes: value("likes"),
    comments: value("replies"),
    shares: value("reposts") + value("quotes"),
    replies: value("replies"),
    reposts: value("reposts"),
    quotes: value("quotes"),
  };
}
