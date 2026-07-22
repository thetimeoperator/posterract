/** Facebook Login + Page Reels publishing helpers. */

const API_VERSION = "v23.0";
const GRAPH = "https://graph.facebook.com";
const PAGE_INSIGHTS_METRIC = "page_media_view";

export const FACEBOOK_PAGE_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
];

export function facebookAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  configId?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: "code",
    state: args.state,
    auth_type: "rerequest",
    return_scopes: "true",
  });
  if (args.configId) {
    // Facebook Login for Business configurations replace an ad-hoc scope
    // list. The override flag is required for the configuration's code flow
    // and ensures Meta presents its business-asset selector.
    params.set("config_id", args.configId);
    params.set("override_default_response_type", "true");
  } else {
    // Development fallback for apps that have not created a Business Login
    // configuration yet.
    params.set("scope", FACEBOOK_PAGE_SCOPES.join(","));
  }
  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params.toString()}`;
}

export type FacebookPage = {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
};

export async function facebookExchangeCode(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  configuredAccessToken?: boolean;
}): Promise<{ accessToken: string; expiresAt?: number; scopes: string[] }> {
  const tokenUrl = new URL(`${GRAPH}/${API_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", args.clientId);
  tokenUrl.searchParams.set("client_secret", args.clientSecret);
  tokenUrl.searchParams.set("redirect_uri", args.redirectUri);
  tokenUrl.searchParams.set("code", args.code.replace(/#_$/, ""));
  const shortResponse = await fetch(tokenUrl);
  const short = (await shortResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!shortResponse.ok || !short.access_token) {
    throw new Error(`Facebook token exchange failed: ${short.error?.message ?? shortResponse.status}`);
  }

  // A Facebook Login for Business configuration controls the returned token's
  // type, lifetime, permissions, and Page targets. Re-exchanging that token
  // through the legacy fb_exchange_token flow can lose its granular Page
  // selection. Use the configured token exactly as Meta returned it.
  if (args.configuredAccessToken) {
    const grantedScopes = await facebookGrantedScopes(short.access_token);
    const missing = FACEBOOK_PAGE_SCOPES.filter((scope) => !grantedScopes.includes(scope));
    if (missing.length > 0) {
      throw new Error(`Facebook did not grant: ${missing.join(", ")}. Reconnect and approve every permission.`);
    }
    return {
      accessToken: short.access_token,
      expiresAt: short.expires_in ? Date.now() + short.expires_in * 1000 : undefined,
      scopes: grantedScopes,
    };
  }

  const longUrl = new URL(`${GRAPH}/${API_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", args.clientId);
  longUrl.searchParams.set("client_secret", args.clientSecret);
  longUrl.searchParams.set("fb_exchange_token", short.access_token);
  const longResponse = await fetch(longUrl);
  const long = (await longResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!longResponse.ok || !long.access_token) {
    throw new Error(`Facebook long-lived token exchange failed: ${long.error?.message ?? longResponse.status}`);
  }

  const grantedScopes = await facebookGrantedScopes(long.access_token);
  const missing = FACEBOOK_PAGE_SCOPES.filter((scope) => !grantedScopes.includes(scope));
  if (missing.length > 0) {
    throw new Error(`Facebook did not grant: ${missing.join(", ")}. Reconnect and approve every permission.`);
  }

  return {
    accessToken: long.access_token,
    expiresAt: long.expires_in ? Date.now() + long.expires_in * 1000 : undefined,
    scopes: grantedScopes,
  };
}

async function facebookGrantedScopes(userAccessToken: string): Promise<string[]> {
  const url = new URL(`${GRAPH}/${API_VERSION}/me/permissions`);
  url.searchParams.set("access_token", userAccessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    data?: Array<{ permission?: string; status?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(`Facebook permission check failed: ${body.error?.message ?? response.status}`);
  }
  return (body.data ?? []).flatMap((row) =>
    row.status === "granted" && row.permission ? [row.permission] : [],
  );
}

type FacebookPageResponse = {
  id?: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
};

function normalizeFacebookPages(pages: FacebookPageResponse[]): FacebookPage[] {
  return pages.flatMap((page) => {
    if (!page.id || !page.access_token) return [];
    return [{
      id: page.id,
      name: page.name ?? "Facebook Page",
      accessToken: page.access_token,
      // Meta's task labels vary between classic Pages, New Pages Experience,
      // and business-owned assets. A returned Page access token plus the
      // explicitly verified OAuth permissions is the reliable authorization
      // boundary; filtering on task-label strings can incorrectly hide a Page.
      tasks: page.tasks ?? [],
    }];
  });
}

export async function facebookListPages(args: {
  userAccessToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<FacebookPage[]> {
  const url = new URL(`${GRAPH}/${API_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,tasks");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", args.userAccessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    data?: FacebookPageResponse[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Facebook Page lookup failed: ${body.error?.message ?? response.status}`);
  const listedPages = normalizeFacebookPages(body.data ?? []);
  if (listedPages.length > 0) return listedPages;

  // Facebook Login grants Page permissions to specific assets. In some Login
  // for Business flows, /me/accounts can be empty even though the token's
  // granular scopes contain the Page IDs the person selected. Meta documents
  // fetching a specific Page access token directly by Page ID, so recover those
  // selected targets instead of treating an empty collection as no access.
  const appTokenUrl = new URL(`${GRAPH}/${API_VERSION}/oauth/access_token`);
  appTokenUrl.searchParams.set("client_id", args.clientId);
  appTokenUrl.searchParams.set("client_secret", args.clientSecret);
  appTokenUrl.searchParams.set("grant_type", "client_credentials");
  const appTokenResponse = await fetch(appTokenUrl);
  const appTokenBody = (await appTokenResponse.json()) as {
    access_token?: string;
    error?: { message?: string };
  };
  if (!appTokenResponse.ok || !appTokenBody.access_token) {
    throw new Error(
      `Facebook Page diagnostic failed while creating the app token (${appTokenResponse.status}): ${appTokenBody.error?.message ?? "Meta returned no app token"}`,
    );
  }

  const debugUrl = new URL(`${GRAPH}/${API_VERSION}/debug_token`);
  debugUrl.searchParams.set("input_token", args.userAccessToken);
  debugUrl.searchParams.set("access_token", appTokenBody.access_token);
  const debugResponse = await fetch(debugUrl);
  const debugBody = (await debugResponse.json()) as {
    data?: {
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
    };
    error?: { message?: string };
  };
  if (!debugResponse.ok) {
    throw new Error(
      `Facebook Page diagnostic failed while inspecting the user token (${debugResponse.status}): ${debugBody.error?.message ?? "Meta returned no token details"}`,
    );
  }

  const pageIds = new Set(
    (debugBody.data?.granular_scopes ?? [])
      .filter((row) => row.scope && FACEBOOK_PAGE_SCOPES.includes(row.scope))
      .flatMap((row) => row.target_ids ?? []),
  );
  if (pageIds.size === 0) {
    throw new Error(
      `Meta granted the Facebook permissions but returned ${body.data?.length ?? 0} Page records and no Page-specific target IDs. Meta did not attach the Page selected in the authorization screen to this access token.`,
    );
  }

  const selectedPageResults = await Promise.all(
    [...pageIds].map(async (pageId): Promise<{ page?: FacebookPageResponse; error?: string }> => {
      const pageUrl = new URL(`${GRAPH}/${API_VERSION}/${pageId}`);
      pageUrl.searchParams.set("fields", "id,name,access_token");
      pageUrl.searchParams.set("access_token", args.userAccessToken);
      const pageResponse = await fetch(pageUrl);
      const pageBody = (await pageResponse.json()) as FacebookPageResponse & {
        error?: { message?: string };
      };
      if (!pageResponse.ok) {
        return {
          error: `${pageResponse.status}: ${pageBody.error?.message ?? "Meta denied the Page lookup"}`,
        };
      }
      if (!pageBody.access_token) {
        return { error: `${pageResponse.status}: Meta returned the Page but omitted its access token` };
      }
      return { page: pageBody };
    }),
  );
  const selectedPages = normalizeFacebookPages(
    selectedPageResults.flatMap((result) => result.page ? [result.page] : []),
  );
  if (selectedPages.length === 0) {
    const reasons = [...new Set(selectedPageResults.flatMap((result) => result.error ? [result.error] : []))];
    throw new Error(
      `Meta authorized ${pageIds.size} Page target${pageIds.size === 1 ? "" : "s"}, but Posterract could not obtain a Page access token. ${reasons.join("; ")}`,
    );
  }
  return selectedPages;
}

export async function facebookRevokeGrant(userAccessToken: string): Promise<void> {
  const url = new URL(`${GRAPH}/${API_VERSION}/me/permissions`);
  url.searchParams.set("access_token", userAccessToken);
  await fetch(url, { method: "DELETE" });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function facebookPublishReel(args: {
  pageId: string;
  pageAccessToken: string;
  videoUrl: string;
  title: string;
  description: string;
  onVideoId?: (videoId: string) => Promise<void> | void;
  onProgress?: (stage: string, detail?: string) => Promise<void> | void;
}): Promise<{ videoId: string; permalink?: string }> {
  await args.onProgress?.("uploading", "Starting Facebook Reel upload");
  const startResponse = await fetch(`${GRAPH}/${API_VERSION}/me/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: args.pageAccessToken, upload_phase: "start" }),
  });
  const started = (await startResponse.json()) as {
    video_id?: string;
    upload_url?: string;
    error?: { message?: string };
  };
  if (!startResponse.ok || !started.video_id || !started.upload_url) {
    throw new Error(`Facebook Reel start failed: ${started.error?.message ?? startResponse.status}`);
  }
  await args.onVideoId?.(started.video_id);

  const uploadResponse = await fetch(started.upload_url, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${args.pageAccessToken}`,
      file_url: args.videoUrl,
    },
  });
  const uploaded = (await uploadResponse.json()) as { success?: boolean; error?: { message?: string } };
  if (!uploadResponse.ok || uploaded.success !== true) {
    throw new Error(`Facebook Reel upload failed: ${uploaded.error?.message ?? uploadResponse.status}`);
  }

  await args.onProgress?.("publishing", "Publishing to Facebook");
  const finishResponse = await fetch(`${GRAPH}/${API_VERSION}/me/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: args.pageAccessToken,
      video_id: started.video_id,
      upload_phase: "finish",
      video_state: "PUBLISHED",
      description: args.description,
      title: args.title,
    }),
  });
  const finished = (await finishResponse.json()) as { success?: boolean; error?: { message?: string } };
  if (!finishResponse.ok || finished.success !== true) {
    throw new Error(`Facebook Reel publish failed: ${finished.error?.message ?? finishResponse.status}`);
  }

  await args.onProgress?.("processing", "Facebook is processing the Reel");
  const deadline = Date.now() + 150_000;
  let permalink: string | undefined;
  while (Date.now() < deadline) {
    const statusUrl = new URL(`${GRAPH}/${API_VERSION}/${started.video_id}`);
    statusUrl.searchParams.set("fields", "status,permalink_url");
    statusUrl.searchParams.set("access_token", args.pageAccessToken);
    const response = await fetch(statusUrl);
    const body = (await response.json()) as {
      permalink_url?: string;
      status?: {
        video_status?: string;
        processing_phase?: { status?: string };
        publishing_phase?: { status?: string };
      };
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(`Facebook Reel status failed: ${body.error?.message ?? response.status}`);
    permalink = body.permalink_url ?? permalink;
    const videoStatus = body.status?.video_status?.toLowerCase();
    const processing = body.status?.processing_phase?.status?.toLowerCase();
    const publishing = body.status?.publishing_phase?.status?.toLowerCase();
    if (videoStatus === "error" || processing === "error" || publishing === "error") {
      throw new Error("Facebook Reel processing failed");
    }
    if (
      videoStatus === "ready" ||
      videoStatus === "published" ||
      publishing === "complete" ||
      publishing === "completed"
    ) break;
    await sleep(4000);
  }

  return { videoId: started.video_id, permalink };
}

export async function facebookPageSummary(args: {
  pageId: string;
  pageAccessToken: string;
}): Promise<{ audience?: number }> {
  const url = new URL(`${GRAPH}/${API_VERSION}/${args.pageId}`);
  url.searchParams.set("fields", "followers_count,fan_count");
  url.searchParams.set("access_token", args.pageAccessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    followers_count?: number;
    fan_count?: number;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Facebook Page lookup failed: ${body.error?.message ?? response.status}`);

  // Exercise the Page Insights edge with the permission Meta reviews for
  // analytics. Page media views are not mixed into our normalized post views;
  // post-level video counters continue to power the visible Views metric.
  const insightsUrl = new URL(
    `${GRAPH}/${API_VERSION}/${args.pageId}/insights/${PAGE_INSIGHTS_METRIC}`,
  );
  insightsUrl.searchParams.set("period", "day");
  insightsUrl.searchParams.set("since", String(Math.floor(Date.now() / 1000) - 7 * 86400));
  insightsUrl.searchParams.set("access_token", args.pageAccessToken);
  const insightsResponse = await fetch(insightsUrl);
  const insightsBody = (await insightsResponse.json()) as { error?: { message?: string } };
  if (!insightsResponse.ok) {
    throw new Error(
      `Facebook Page insights failed: ${insightsBody.error?.message ?? insightsResponse.status}`,
    );
  }
  return { audience: body.followers_count ?? body.fan_count };
}

export async function facebookPostInsights(args: {
  videoId: string;
  pageAccessToken: string;
}): Promise<{ views: number; likes: number; comments: number; shares: number }> {
  const url = new URL(`${GRAPH}/${API_VERSION}/${args.videoId}`);
  url.searchParams.set("fields", "views,likes.summary(true),comments.summary(true)");
  url.searchParams.set("access_token", args.pageAccessToken);
  const response = await fetch(url);
  const body = (await response.json()) as {
    views?: number;
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`Facebook post insights failed: ${body.error?.message ?? response.status}`);
  return {
    views: body.views ?? 0,
    likes: body.likes?.summary?.total_count ?? 0,
    comments: body.comments?.summary?.total_count ?? 0,
    shares: 0,
  };
}
