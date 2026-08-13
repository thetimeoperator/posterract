import http from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NativeConnection, Worker } from "@temporalio/worker";
import { ApplicationFailure } from "@temporalio/common";
import { Pool } from "pg";
import {
  decryptSecret,
  encryptSecret,
} from "../../api/src/security.js";
import {
  instagramAccountSummary,
  instagramPostInsights,
  instagramPublishReel,
  instagramRefreshToken,
} from "../../web/convex/connectors/instagram.ts";
import {
  facebookPageSummary,
  facebookPostInsights,
  facebookPublishReel,
} from "../../web/convex/connectors/facebook.ts";
import {
  threadsAccountInsights,
  threadsPostInsights,
  threadsPublishVideo,
  threadsRefreshToken,
} from "../../web/convex/connectors/threads.ts";
import {
  tiktokGetUserStats,
  tiktokGetVideoStats,
  tiktokPublishVideo,
  tiktokRefreshToken,
} from "../../web/convex/connectors/tiktok.ts";
import {
  youtubeChannelAnalyticsReport,
  youtubeGetVideo,
  youtubeGetMyChannel,
  youtubeGetVideos,
  youtubeRefreshToken,
  youtubeStartResumableUpload,
  youtubeUploadResumable,
} from "../../web/convex/connectors/youtube.ts";

const env = process.env;
const postgres = new Pool({
  connectionString: env.DATABASE_URL,
  max: Number(env.POSTGRES_POOL_MAX ?? 10),
});

const r2Endpoint =
  env.R2_ENDPOINT?.replace(/\/+$/, "") ||
  (env.R2_ACCOUNT_ID
    ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined);
const r2 = new S3Client({
  region: env.R2_REGION ?? "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

function safeMessage(error, fallback = "Platform publishing failed") {
  const value = error instanceof Error ? error.message : fallback;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .slice(0, 500);
}

function errorCategory(error) {
  const message = safeMessage(error).toLowerCase();
  if (
    error?.status === 401 ||
    error?.status === 403 ||
    /token|oauth|unauthor|permission|reauth|credential/.test(message)
  ) {
    return "auth";
  }
  if (error?.status === 429 || /rate.?limit|too many requests|quota/.test(message)) {
    return "rate_limit";
  }
  if (/invalid|unsupported|too (long|large|short)|validation/.test(message)) {
    return "validation";
  }
  if (error?.retryable === true || error instanceof TypeError) return "transient";
  return "platform";
}

function isRetryable(error) {
  const category = errorCategory(error);
  return (
    error?.retryable === true ||
    error instanceof TypeError ||
    category === "rate_limit" ||
    [429, 500, 502, 503, 504].includes(error?.status)
  );
}

async function emit(row, type, message, payload = {}) {
  await postgres.query(
    `insert into events
      (workspace_id, transmission_id, projection_id, type, message, payload)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      row.workspace_id,
      row.transmission_id,
      row.id,
      type,
      message,
      JSON.stringify(payload),
    ],
  );
}

async function progress(row, stage, detail) {
  const status = ["uploading", "publishing", "processing"].includes(stage)
    ? stage
    : "uploading";
  await postgres.query(
    `update projections set status = $2, updated_at = now() where id = $1`,
    [row.id, status],
  );
  if (detail) await emit(row, `projection.${stage}`, detail);
}

async function signedMediaUrl(r2Key) {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: r2Key }),
    { expiresIn: Number(env.R2_SIGNED_DOWNLOAD_TTL_SECONDS ?? 3_600) },
  );
}

async function loadProjectionContext(projectionId) {
  const result = await postgres.query(
    `select p.*, t.title, t.base_caption, t.status as transmission_status,
            m.r2_key, m.mime_type, m.size_bytes,
            a.provider_account_id, a.handle, a.status as account_status,
            coalesce(tok.provider_user_id, a.provider_account_id) as provider_user_id,
            tok.access_token_ciphertext, tok.refresh_token_ciphertext,
            coalesce(tok.access_token_expires_at, a.token_expires_at) as access_token_expires_at,
            tok.refresh_expires_at
     from projections p
     join transmissions t on t.id = p.transmission_id
     join media_assets m on m.id = t.media_asset_id
     left join social_accounts a on a.id = p.social_account_id
     left join social_account_tokens tok on tok.social_account_id = a.id
     where p.id = $1`,
    [projectionId],
  );
  return result.rows[0] ?? null;
}

async function refreshAccessToken(row, accessToken, refreshToken) {
  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : undefined;
  if (!expiresAt || expiresAt > Date.now() + 10 * 60_000) return accessToken;

  let refreshed;
  if (row.provider === "instagram") {
    refreshed = await instagramRefreshToken(accessToken);
  } else if (row.provider === "threads") {
    refreshed = await threadsRefreshToken(accessToken);
  } else if (row.provider === "tiktok") {
    if (!refreshToken || !env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new Error("TikTok refresh credentials are missing — reconnect required");
    }
    refreshed = await tiktokRefreshToken({
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      refreshToken,
    });
  } else if (row.provider === "youtube") {
    if (!refreshToken || !env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
      throw new Error("YouTube refresh credentials are missing — reconnect required");
    }
    refreshed = await youtubeRefreshToken({
      clientId: env.YOUTUBE_CLIENT_ID,
      clientSecret: env.YOUTUBE_CLIENT_SECRET,
      refreshToken,
    });
  } else {
    throw new Error(`${row.provider} token expired — reconnect required`);
  }

  const nextAccessToken = refreshed.accessToken;
  const nextRefreshToken = refreshed.refreshToken ?? refreshToken;
  await postgres.query(
    `update social_account_tokens
     set access_token_ciphertext = $2,
         refresh_token_ciphertext = coalesce($3, refresh_token_ciphertext),
         access_token_expires_at = $4,
         refresh_expires_at = coalesce($5, refresh_expires_at),
         updated_at = now()
     where social_account_id = $1`,
    [
      row.social_account_id,
      encryptSecret(nextAccessToken),
      nextRefreshToken ? encryptSecret(nextRefreshToken) : null,
      refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
      refreshed.refreshExpiresAt
        ? new Date(refreshed.refreshExpiresAt)
        : null,
    ],
  );
  await postgres.query(
    `update social_accounts
     set token_expires_at = $2, updated_at = now()
     where id = $1`,
    [
      row.social_account_id,
      refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
    ],
  );
  return nextAccessToken;
}

async function youtubePublish(row, accessToken, videoUrl) {
  const existing = await postgres.query(
    `select session_reference_ciphertext, uploaded_bytes
     from provider_upload_sessions
     where projection_id = $1 and provider = 'youtube'`,
    [row.id],
  );
  let uploadUrl = existing.rows[0]?.session_reference_ciphertext
    ? decryptSecret(existing.rows[0].session_reference_ciphertext)
    : undefined;
  let uploadedBytes = existing.rows[0]?.uploaded_bytes;
  if (!uploadUrl) {
    const options = row.platform_options ?? {};
    uploadUrl = await youtubeStartResumableUpload({
      accessToken,
      mimeType: row.mime_type,
      totalBytes: Number(row.size_bytes),
      metadata: {
        title: String(options.title ?? row.title).slice(0, 100),
        description: row.caption.slice(0, 5_000),
        privacyStatus: ["public", "unlisted", "private"].includes(
          options.privacyStatus,
        )
          ? options.privacyStatus
          : "private",
        madeForKids: options.madeForKids === true,
        containsSyntheticMedia: options.containsSyntheticMedia === true,
        notifySubscribers: options.notifySubscribers === true,
        categoryId: typeof options.categoryId === "string" ? options.categoryId : "22",
      },
    });
    await postgres.query(
      `insert into provider_upload_sessions
        (projection_id, provider, session_reference_ciphertext)
       values ($1, 'youtube', $2)
       on conflict (projection_id, provider) do update
       set session_reference_ciphertext = excluded.session_reference_ciphertext,
           uploaded_bytes = 0, updated_at = now()`,
      [row.id, encryptSecret(uploadUrl)],
    );
  }

  await progress(row, "uploading", "Uploading video to YouTube");
  const result = await youtubeUploadResumable({
    accessToken,
    uploadUrl,
    videoUrl,
    totalBytes: Number(row.size_bytes),
    mimeType: row.mime_type,
    startingOffset: uploadedBytes === null || uploadedBytes === undefined
      ? undefined
      : Number(uploadedBytes),
    onProgress: async (bytes) => {
      await postgres.query(
        `update provider_upload_sessions
         set uploaded_bytes = $2, updated_at = now()
         where projection_id = $1 and provider = 'youtube'`,
        [row.id, bytes],
      );
    },
  });
  await progress(row, "processing", "YouTube is processing the video");
  let video = await youtubeGetVideo(accessToken, result.videoId);
  for (let poll = 0; poll < 10; poll += 1) {
    const processing = video?.processingDetails?.processingStatus;
    if (processing === "succeeded" || video?.status?.uploadStatus === "processed") {
      await postgres.query(
        `delete from provider_upload_sessions
         where projection_id = $1 and provider = 'youtube'`,
        [row.id],
      );
      return {
        platformPostId: result.videoId,
        platformPostUrl: `https://youtube.com/shorts/${result.videoId}`,
        status: "live",
      };
    }
    if (processing === "failed" || video?.status?.uploadStatus === "failed") {
      throw new Error("YouTube could not process this video");
    }
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    video = await youtubeGetVideo(accessToken, result.videoId);
  }
  const error = new Error("YouTube is still processing — will retry");
  error.retryable = true;
  throw error;
}

async function executeConnector(row, accessToken, videoUrl) {
  const onProgress = (stage, detail) => progress(row, stage, detail);
  const onContainer = async (containerId) => {
    await postgres.query(
      `update projections
       set pending_container_id = $2, platform_media_id = $2, updated_at = now()
       where id = $1`,
      [row.id, containerId],
    );
  };

  if (row.provider === "instagram") {
    const result = await instagramPublishReel({
      igUserId: row.provider_user_id,
      accessToken,
      videoUrl,
      caption: row.caption,
      resumeContainerId: row.pending_container_id ?? undefined,
      onContainer,
      onProgress,
    });
    return {
      status: "live",
      platformPostId: result.mediaId,
      platformPostUrl:
        result.permalink ?? `https://www.instagram.com/reel/${result.mediaId}`,
    };
  }
  if (row.provider === "threads") {
    const result = await threadsPublishVideo({
      userId: row.provider_user_id,
      accessToken,
      videoUrl,
      text: row.caption,
      resumeContainerId: row.pending_container_id ?? undefined,
      onContainer,
      onProgress,
    });
    return {
      status: "live",
      platformPostId: result.mediaId,
      platformPostUrl:
        result.permalink ?? `https://www.threads.net/@${row.handle}/post/${result.mediaId}`,
    };
  }
  if (row.provider === "facebook") {
    const result = await facebookPublishReel({
      pageId: row.provider_user_id,
      pageAccessToken: accessToken,
      videoUrl,
      title: row.title,
      description: row.caption,
      onVideoId: onContainer,
      onProgress,
    });
    return {
      status: "live",
      platformPostId: result.videoId,
      platformPostUrl:
        result.permalink ??
        `https://www.facebook.com/${row.provider_user_id}/videos/${result.videoId}`,
    };
  }
  if (row.provider === "tiktok") {
    const result = await tiktokPublishVideo({
      accessToken,
      videoUrl,
      caption: row.caption,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      resumePublishId: row.pending_container_id ?? undefined,
      onPublishId: onContainer,
      onProgress,
    });
    return {
      status: "live",
      platformPostId: result.postId ?? result.publishId,
      platformPostUrl: result.postId
        ? `https://www.tiktok.com/@${row.handle}/video/${result.postId}`
        : undefined,
    };
  }
  if (row.provider === "youtube") {
    return youtubePublish(row, accessToken, videoUrl);
  }
  throw Object.assign(new Error("X connector is not configured"), {
    category: "config",
    retryable: false,
  });
}

const analyticsRequiredScopes = {
  instagram: ["instagram_business_basic", "instagram_business_manage_insights"],
  facebook: ["pages_read_engagement", "read_insights"],
  threads: ["threads_basic", "threads_manage_insights"],
  tiktok: ["user.info.stats", "video.list"],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
};

const metricDate = (value = Date.now()) =>
  new Date(value).toISOString().slice(0, 10);

async function loadAnalyticsContext(accountId) {
  const accountResult = await postgres.query(
    `select a.*, a.id as social_account_id,
            coalesce(t.provider_user_id, a.provider_account_id) as provider_user_id,
            t.access_token_ciphertext, t.refresh_token_ciphertext,
            coalesce(t.access_token_expires_at, a.token_expires_at) as access_token_expires_at,
            t.refresh_expires_at
     from social_accounts a
     join social_account_tokens t on t.social_account_id = a.id
     where a.id = $1 and a.status = 'connected'`,
    [accountId],
  );
  const account = accountResult.rows[0];
  if (!account) return undefined;
  const projections = await postgres.query(
    `select id, platform_post_id
     from projections
     where social_account_id = $1 and provider = $2 and status = 'live'
       and updated_at >= now() - interval '90 days'
       and platform_post_id is not null`,
    [account.id, account.provider],
  );
  return { account, projections: projections.rows };
}

async function applyCumulativeAnalytics(account, summary, videos) {
  const client = await postgres.connect();
  try {
    await client.query("begin");
    const previousAccount = await client.query(
      `select audience from account_metric_snapshots
       where social_account_id = $1 order by fetched_at desc, id desc limit 1`,
      [account.id],
    );
    const previousAudience = previousAccount.rows[0]?.audience;
    const audienceDelta =
      summary.audience === undefined || previousAudience == null
        ? 0
        : Number(summary.audience) - Number(previousAudience);
    await client.query(
      `insert into account_metric_snapshots
        (social_account_id, workspace_id, provider, audience, total_views,
         total_likes, published_videos, raw_metrics, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        account.id,
        account.workspace_id,
        account.provider,
        summary.audience ?? null,
        summary.totalViews ?? null,
        summary.totalLikes ?? null,
        summary.publishedVideos ?? null,
        JSON.stringify(summary),
      ],
    );

    const deltas = { views: 0, likes: 0, comments: 0, shares: 0 };
    for (const video of videos) {
      const previous = await client.query(
        `select views, likes, comments, shares
         from publication_metric_snapshots
         where projection_id = $1
         order by fetched_at desc, id desc limit 1`,
        [video.projectionId],
      );
      const prior = previous.rows[0] ?? video;
      deltas.views += Math.max(0, Number(video.views) - Number(prior.views ?? 0));
      deltas.likes += Math.max(0, Number(video.likes) - Number(prior.likes ?? 0));
      deltas.comments += Math.max(
        0,
        Number(video.comments) - Number(prior.comments ?? 0),
      );
      deltas.shares += Math.max(0, Number(video.shares) - Number(prior.shares ?? 0));
      await client.query(
        `insert into publication_metric_snapshots
          (projection_id, workspace_id, provider, views, likes, comments,
           shares, raw_metrics, fetched_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          video.projectionId,
          account.workspace_id,
          account.provider,
          video.views,
          video.likes,
          video.comments,
          video.shares,
          JSON.stringify(video),
        ],
      );
    }
    await client.query(
      `insert into daily_metric_snapshots
        (social_account_id, workspace_id, provider, metric_date, views, likes,
         comments, shares, audience_gained, audience_lost, fetched_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (social_account_id, metric_date) do update
       set views = daily_metric_snapshots.views + excluded.views,
           likes = daily_metric_snapshots.likes + excluded.likes,
           comments = daily_metric_snapshots.comments + excluded.comments,
           shares = daily_metric_snapshots.shares + excluded.shares,
           audience_gained = daily_metric_snapshots.audience_gained + excluded.audience_gained,
           audience_lost = daily_metric_snapshots.audience_lost + excluded.audience_lost,
           fetched_at = now()`,
      [
        account.id,
        account.workspace_id,
        account.provider,
        metricDate(),
        deltas.views,
        deltas.likes,
        deltas.comments,
        deltas.shares,
        Math.max(0, audienceDelta),
        Math.max(0, -audienceDelta),
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function applyYouTubeAnalytics(account, channel, history, videos) {
  const client = await postgres.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into account_metric_snapshots
        (social_account_id, workspace_id, provider, audience, total_views,
         published_videos, raw_metrics, fetched_at)
       values ($1, $2, 'youtube', $3, $4, $5, $6, now())`,
      [
        account.id,
        account.workspace_id,
        channel.statistics.subscribers ?? null,
        channel.statistics.views,
        channel.statistics.videos,
        JSON.stringify(channel.statistics),
      ],
    );
    for (const row of history) {
      await client.query(
        `insert into daily_metric_snapshots
          (social_account_id, workspace_id, provider, metric_date, views, likes,
           comments, shares, watch_minutes, audience_gained, audience_lost,
           raw_metrics, fetched_at)
         values ($1, $2, 'youtube', $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         on conflict (social_account_id, metric_date) do update
         set views = excluded.views, likes = excluded.likes,
             comments = excluded.comments, shares = excluded.shares,
             watch_minutes = excluded.watch_minutes,
             audience_gained = excluded.audience_gained,
             audience_lost = excluded.audience_lost,
             raw_metrics = excluded.raw_metrics, fetched_at = now()`,
        [
          account.id,
          account.workspace_id,
          row.date,
          row.views,
          row.likes,
          row.comments,
          row.shares,
          row.estimatedMinutesWatched,
          row.subscribersGained,
          row.subscribersLost,
          JSON.stringify(row),
        ],
      );
    }
    for (const video of videos) {
      await client.query(
        `insert into publication_metric_snapshots
          (projection_id, workspace_id, provider, views, likes, comments,
           shares, raw_metrics, fetched_at)
         values ($1, $2, 'youtube', $3, $4, $5, 0, $6, now())`,
        [
          video.projectionId,
          account.workspace_id,
          Number(video.statistics?.viewCount ?? 0),
          Number(video.statistics?.likeCount ?? 0),
          Number(video.statistics?.commentCount ?? 0),
          JSON.stringify(video.statistics ?? {}),
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function refreshAccountAnalytics(accountId) {
  const started = await postgres.query(
    `insert into analytics_sync_runs
      (workspace_id, social_account_id, provider, status)
     select workspace_id, id, provider, 'running'
     from social_accounts where id = $1
     returning id`,
    [accountId],
  );
  const runId = started.rows[0]?.id;
  try {
    const context = await loadAnalyticsContext(accountId);
    if (!context) {
      if (runId) {
        await postgres.query(
          `update analytics_sync_runs
           set status = 'skipped', completed_at = now() where id = $1`,
          [runId],
        );
      }
      return { status: "skipped" };
    }
    const { account, projections } = context;
    const required = analyticsRequiredScopes[account.provider] ?? [];
    const scopes = new Set(account.scopes ?? []);
    if (!required.every((scope) => scopes.has(scope))) {
      await postgres.query(
        `update analytics_sync_runs
         set status = 'skipped', error_summary = 'missing scopes',
             completed_at = now() where id = $1`,
        [runId],
      );
      return { status: "skipped", reason: "missing_scopes" };
    }
    let accessToken = decryptSecret(account.access_token_ciphertext);
    const refreshToken = account.refresh_token_ciphertext
      ? decryptSecret(account.refresh_token_ciphertext)
      : undefined;
    accessToken = await refreshAccessToken(account, accessToken, refreshToken);

    if (account.provider === "youtube") {
      const startDate = metricDate(Date.now() - 89 * 86_400_000);
      const endDate = metricDate();
      const [channel, history] = await Promise.all([
        youtubeGetMyChannel(accessToken),
        youtubeChannelAnalyticsReport({ accessToken, startDate, endDate }),
      ]);
      const projectionByPostId = new Map(
        projections.map((projection) => [projection.platform_post_id, projection.id]),
      );
      const postIds = [...projectionByPostId.keys()];
      const videos = [];
      for (let index = 0; index < postIds.length; index += 50) {
        const rows = await youtubeGetVideos(accessToken, postIds.slice(index, index + 50));
        for (const row of rows) {
          const projectionId = projectionByPostId.get(row.id);
          if (projectionId) videos.push({ projectionId, ...row });
        }
      }
      await applyYouTubeAnalytics(account, channel, history, videos);
    } else {
      const videos = [];
      for (const projection of projections) {
        try {
          const metric =
            account.provider === "instagram"
              ? await instagramPostInsights({
                  mediaId: projection.platform_post_id,
                  accessToken,
                })
              : account.provider === "facebook"
                ? await facebookPostInsights({
                    videoId: projection.platform_post_id,
                    pageAccessToken: accessToken,
                  })
                : account.provider === "threads"
                  ? await threadsPostInsights({
                      mediaId: projection.platform_post_id,
                      accessToken,
                    })
                  : undefined;
          if (metric) videos.push({ projectionId: projection.id, ...metric });
        } catch {
          // Deleted and newly processing posts do not block the account refresh.
        }
      }

      let summary;
      if (account.provider === "instagram") {
        summary = await instagramAccountSummary({
          userId: account.provider_user_id,
          accessToken,
        });
      } else if (account.provider === "facebook") {
        summary = await facebookPageSummary({
          pageId: account.provider_user_id,
          pageAccessToken: accessToken,
        });
      } else if (account.provider === "threads") {
        summary = await threadsAccountInsights({ accessToken });
      } else if (account.provider === "tiktok") {
        const user = await tiktokGetUserStats(accessToken);
        const projectionByPostId = new Map(
          projections.map((projection) => [projection.platform_post_id, projection.id]),
        );
        const postIds = [...projectionByPostId.keys()];
        for (let index = 0; index < postIds.length; index += 20) {
          const metrics = await tiktokGetVideoStats(
            accessToken,
            postIds.slice(index, index + 20),
          );
          for (const metric of metrics) {
            const projectionId = projectionByPostId.get(metric.id);
            if (projectionId) videos.push({ projectionId, ...metric });
          }
        }
        summary = {
          audience: user.followers,
          totalLikes: user.totalLikes,
          publishedVideos: user.videos,
        };
      } else {
        await postgres.query(
          `update analytics_sync_runs
           set status = 'skipped', completed_at = now() where id = $1`,
          [runId],
        );
        return { status: "skipped" };
      }
      await applyCumulativeAnalytics(account, summary, videos);
    }

    await postgres.query(
      `update analytics_sync_runs
       set status = 'completed', completed_at = now(), records_written = 1
       where id = $1`,
      [runId],
    );
    await postgres.query(
      `update social_accounts
       set last_health_check_at = now(), updated_at = now() where id = $1`,
      [accountId],
    );
    return { status: "completed" };
  } catch (error) {
    const message = safeMessage(error, "Analytics refresh failed");
    if (runId) {
      await postgres.query(
        `update analytics_sync_runs
         set status = 'failed', error_summary = $2, completed_at = now()
         where id = $1`,
        [runId, message],
      );
    }
    const account = await postgres.query(
      "select workspace_id, provider from social_accounts where id = $1",
      [accountId],
    );
    if (account.rows[0]) {
      await postgres.query(
        `insert into events (workspace_id, type, message, payload)
         values ($1, 'analytics.refresh_failed', $2, $3)`,
        [
          account.rows[0].workspace_id,
          `${account.rows[0].provider} analytics refresh failed — ${message}`,
          JSON.stringify({ provider: account.rows[0].provider }),
        ],
      );
    }
    return { status: "failed", error: message };
  }
}

const activities = {
  async listAnalyticsAccounts() {
    const result = await postgres.query(
      `select id from social_accounts
       where status = 'connected'
         and provider in ('instagram', 'facebook', 'threads', 'tiktok', 'youtube')
       order by updated_at asc`,
    );
    return result.rows.map((row) => row.id);
  },

  refreshAccountAnalytics,

  async loadTransmission(transmissionId) {
    const result = await postgres.query(
      "select * from transmissions where id = $1",
      [transmissionId],
    );
    return result.rows[0] ?? null;
  },

  async loadPendingProjections(transmissionId, projectionIds) {
    const result = await postgres.query(
      `select *
       from projections
       where transmission_id = $1
         and status in ('pending', 'scheduled', 'retrying')
         and ($2::uuid[] is null or id = any($2::uuid[]))
       order by created_at asc`,
      [transmissionId, projectionIds?.length ? projectionIds : null],
    );
    return result.rows;
  },

  async markTransmissionTransmitting(transmissionId) {
    await postgres.query(
      `update transmissions
       set status = 'transmitting', updated_at = now()
       where id = $1 and status <> 'canceled'`,
      [transmissionId],
    );
    await postgres.query(
      `update media_assets m
       set status = 'publishing', updated_at = now()
       from transmissions t
       where t.id = $1 and m.id = t.media_asset_id`,
      [transmissionId],
    );
  },

  async markTransmissionCanceled(transmissionId) {
    await postgres.query(
      `update transmissions
       set status = 'canceled', canceled_at = coalesce(canceled_at, now()),
           updated_at = now()
       where id = $1`,
      [transmissionId],
    );
    await postgres.query(
      `update projections
       set status = 'canceled', canceled_at = coalesce(canceled_at, now()),
           updated_at = now()
       where transmission_id = $1
         and status in ('pending', 'scheduled', 'retrying')`,
      [transmissionId],
    );
    await postgres.query(
      `update media_assets m
       set status = 'attached',
           purge_after = coalesce(m.purge_after, now() + interval '24 hours'),
           updated_at = now()
       from transmissions t
       where t.id = $1 and m.id = t.media_asset_id
         and not exists (
           select 1 from transmissions active
           where active.media_asset_id = m.id and active.id <> t.id
             and active.status in ('scheduled', 'transmitting')
         )`,
      [transmissionId],
    );
  },

  async publishProjection(projectionId) {
    const row = await loadProjectionContext(projectionId);
    if (!row) {
      throw ApplicationFailure.nonRetryable(
        "Projection does not exist",
        "projection_not_found",
      );
    }
    if (row.transmission_status === "canceled") return { status: "canceled" };
    if (row.account_status !== "connected" || !row.access_token_ciphertext) {
      const message = `${row.provider} account must be reconnected`;
      await postgres.query(
        `update projections
         set status = 'needs_reauth', error_category = 'auth',
             error_summary = $2, updated_at = now()
         where id = $1`,
        [row.id, message],
      );
      await emit(row, "projection.failed", message);
      throw ApplicationFailure.nonRetryable(message, "account_not_connected");
    }

    const attemptResult = await postgres.query(
      `update projections
       set status = 'uploading', attempt_count = attempt_count + 1,
           error_category = null, error_summary = null, updated_at = now()
       where id = $1
       returning attempt_count`,
      [row.id],
    );
    const attempt = attemptResult.rows[0].attempt_count;
    await postgres.query(
      `insert into publish_attempts
        (projection_id, attempt_number, status)
       values ($1, $2, 'started')
       on conflict (projection_id, attempt_number) do update
       set status = 'started', started_at = now(), completed_at = null`,
      [row.id, attempt],
    );
    await emit(row, "projection.started", `Publishing to ${row.provider}`, {
      attempt,
    });

    try {
      let accessToken = decryptSecret(row.access_token_ciphertext);
      const refreshToken = row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext)
        : undefined;
      accessToken = await refreshAccessToken(row, accessToken, refreshToken);
      const videoUrl = await signedMediaUrl(row.r2_key);
      const result = await executeConnector(row, accessToken, videoUrl);
      await postgres.query(
        `update projections
         set status = $2, platform_post_id = $3, platform_post_url = $4,
             pending_container_id = null, published_at = case when $2 = 'live' then now() else published_at end,
             error_category = null, error_summary = null, updated_at = now()
         where id = $1`,
        [
          row.id,
          result.status,
          result.platformPostId ?? null,
          result.platformPostUrl ?? null,
        ],
      );
      await postgres.query(
        `update publish_attempts
         set status = 'succeeded', completed_at = now()
         where projection_id = $1 and attempt_number = $2`,
        [row.id, attempt],
      );
      if (result.status === "live") {
        await postgres.query(
          `insert into points_ledger
            (workspace_id, source, amount, reference_id, note)
           values ($1, 'post', 10, $2, $3)
           on conflict (reference_id, source) do nothing`,
          [row.workspace_id, `projection:${row.id}`, `${row.provider} post live`],
        );
      }
      await emit(
        row,
        `projection.${result.status}`,
        result.status === "live"
          ? `${row.provider} post is live`
          : `${row.provider} is processing the post`,
        { platformPostUrl: result.platformPostUrl },
      );
      return result;
    } catch (error) {
      const category = error.category ?? errorCategory(error);
      const retryable = isRetryable(error);
      const message = safeMessage(error);
      const status = retryable
        ? "retrying"
        : category === "auth"
          ? "needs_reauth"
          : category === "config"
            ? "blocked"
            : "failed";
      await postgres.query(
        `update projections
         set status = $2, error_category = $3, error_summary = $4,
             next_attempt_at = case when $5 then now() + interval '2 minutes' else null end,
             updated_at = now()
         where id = $1`,
        [row.id, status, category, message, retryable],
      );
      await postgres.query(
        `update publish_attempts
         set status = $3, provider_code = $4,
             sanitized_summary = $5, completed_at = now()
         where projection_id = $1 and attempt_number = $2`,
        [
          row.id,
          attempt,
          retryable ? "retrying" : "failed",
          error.reason ?? null,
          JSON.stringify({ category, message, retryable }),
        ],
      );
      await emit(
        row,
        retryable ? "projection.retrying" : "projection.failed",
        `${row.provider}: ${message}`,
        { category, retryable },
      );
      if (!retryable) {
        throw ApplicationFailure.nonRetryable(message, category);
      }
      throw error;
    }
  },

  async finalizeTransmission(transmissionId) {
    const result = await postgres.query(
      `with counts as (
         select count(*) as total,
                count(*) filter (where status = 'live') as live,
                count(*) filter (where status in ('failed', 'blocked', 'needs_reauth', 'canceled')) as terminal
         from projections where transmission_id = $1
       )
       update transmissions
       set status = case
         when transmissions.status = 'canceled' then 'canceled'
         when counts.live = counts.total and counts.total > 0 then 'live'
         when counts.live > 0 and counts.live + counts.terminal = counts.total then 'partial'
         when counts.terminal = counts.total then 'failed'
         else 'transmitting'
       end,
       updated_at = now()
       from counts
       where transmissions.id = $1
       returning transmissions.status`,
      [transmissionId],
    );
    const status = result.rows[0]?.status;
    if (["live", "partial", "failed", "canceled"].includes(status)) {
      const retentionHours = status === "live" ? 48 : status === "canceled" ? 24 : 168;
      await postgres.query(
        `update media_assets m
         set status = 'attached',
             purge_after = now() + ($2::integer * interval '1 hour'),
             updated_at = now()
         from transmissions t
         where t.id = $1 and m.id = t.media_asset_id
           and not exists (
             select 1 from transmissions active
             where active.media_asset_id = m.id and active.id <> t.id
               and active.status in ('scheduled', 'transmitting')
           )`,
        [transmissionId, retentionHours],
      );
    }
    return status;
  },

  async enqueueAnalyticsIndex(transmissionId) {
    await postgres.query(
      `insert into outbox_events (aggregate_type, aggregate_id, event_type, payload)
       values ('transmission', $1, 'transmission.analytics_index_requested',
         jsonb_build_object('transmissionId', $1::text))`,
      [transmissionId],
    );
  },

  async enqueueMediaCleanup() {
    return undefined;
  },
};

const connection = await NativeConnection.connect({
  address: env.TEMPORAL_ADDRESS,
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: env.TEMPORAL_TASK_QUEUE ?? "posterract-publishing",
  workflowsPath: join(currentDirectory, "workflows.js"),
  activities,
  maxConcurrentActivityTaskExecutions: Number(
    env.MAX_CONCURRENT_ACTIVITIES ?? 4,
  ),
  maxConcurrentWorkflowTaskExecutions: Number(
    env.MAX_CONCURRENT_WORKFLOWS ?? 20,
  ),
});

let healthy = true;
const healthServer = http.createServer((request, response) => {
  if (request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(healthy ? 200 : 503, { "content-type": "application/json" })
    .end(JSON.stringify({ ok: healthy, service: "posterract-orchestrator" }));
});
healthServer.listen(Number(env.HEALTH_PORT ?? 3002), "0.0.0.0");

async function shutdown() {
  healthy = false;
  worker.shutdown();
  healthServer.close();
  await postgres.end();
  await connection.close();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  await worker.run();
} finally {
  await shutdown();
}
