export const PLATFORM_IDS = [
  "instagram",
  "tiktok",
  "facebook",
  "threads",
  "x",
  "youtube",
];

const platformSet = new Set(PLATFORM_IDS);
const captionLimits = {
  instagram: 2_200,
  tiktok: 2_200,
  facebook: 63_206,
  threads: 500,
  x: 280,
  youtube: 5_000,
};
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class RequestValidationError extends Error {
  constructor(code, details = undefined) {
    super(code);
    this.name = "RequestValidationError";
    this.code = code;
    this.details = details;
  }
}

function optionalString(value, field, maximum) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) {
    throw new RequestValidationError("invalid_field", { field });
  }
  return value;
}

function hashtags(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 30 ||
    value.some((item) => typeof item !== "string" || item.length > 100)
  ) {
    throw new RequestValidationError("invalid_hashtags");
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function schedule(value, now) {
  if (value === undefined || value === null || value === "now") {
    return { mode: "now", at: now };
  }
  if (typeof value !== "string") {
    throw new RequestValidationError("invalid_scheduled_for");
  }
  const at = new Date(value);
  if (!Number.isFinite(at.getTime()) || at.getTime() < now.getTime() - 30_000) {
    throw new RequestValidationError("invalid_scheduled_for");
  }
  if (at.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1_000) {
    throw new RequestValidationError("scheduled_for_too_far");
  }
  return { mode: "at", at };
}

export function parseCreatePost(body, now = new Date()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestValidationError("invalid_request");
  }
  if (typeof body.artifactId !== "string" || !uuidPattern.test(body.artifactId)) {
    throw new RequestValidationError("invalid_artifact_id");
  }
  const title = optionalString(body.title, "title", 200)?.trim() || "Untitled post";
  if (typeof body.caption !== "string") {
    throw new RequestValidationError("invalid_caption");
  }
  if (
    !Array.isArray(body.platforms) ||
    body.platforms.length === 0 ||
    body.platforms.some((provider) => !platformSet.has(provider))
  ) {
    throw new RequestValidationError("invalid_platforms");
  }
  const platforms = [...new Set(body.platforms)];
  if (platforms.length !== body.platforms.length) {
    throw new RequestValidationError("duplicate_platform");
  }

  const baseHashtags = hashtags(body.hashtags);
  const overrides = body.perPlatform ?? body.platformOptions ?? {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new RequestValidationError("invalid_platform_overrides");
  }
  for (const provider of Object.keys(overrides)) {
    if (!platformSet.has(provider) || !platforms.includes(provider)) {
      throw new RequestValidationError("unexpected_platform_override", {
        provider,
      });
    }
  }

  const projections = platforms.map((provider) => {
    const override = overrides[provider] ?? {};
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      throw new RequestValidationError("invalid_platform_override", { provider });
    }
    const caption = optionalString(
      override.caption,
      `${provider}.caption`,
      captionLimits[provider],
    ) ?? body.caption;
    if (caption.length > captionLimits[provider]) {
      throw new RequestValidationError("caption_too_long", {
        provider,
        maximum: captionLimits[provider],
      });
    }
    const options = override.options ?? {};
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new RequestValidationError("invalid_platform_options", {
        provider,
      });
    }
    return {
      provider,
      caption,
      hashtags: override.hashtags
        ? hashtags(override.hashtags)
        : baseHashtags,
      options,
    };
  });

  const scheduled = schedule(body.scheduledFor, now);
  return {
    artifactId: body.artifactId,
    title,
    caption: body.caption,
    hashtags: baseHashtags,
    scheduleMode: scheduled.mode,
    scheduledFor: scheduled.at,
    status: scheduled.mode === "now" ? "scheduled" : "scheduled",
    projections,
  };
}

export function transmissionStatus(statuses) {
  if (statuses.length === 0) return "failed";
  const live = statuses.filter((status) => status === "live").length;
  const terminalFailure = statuses.filter((status) =>
    ["failed", "blocked", "needs_reauth"].includes(status),
  ).length;
  const canceled = statuses.filter((status) => status === "canceled").length;
  if (live === statuses.length) return "live";
  if (live > 0 && live + terminalFailure + canceled === statuses.length) {
    return "partial";
  }
  if (terminalFailure + canceled === statuses.length) return "failed";
  return "transmitting";
}

export function publicPost(row, projections) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    caption: row.base_caption,
    hashtags: row.hashtags ?? [],
    mediaId: row.media_asset_id,
    scheduledFor: row.scheduled_for?.toISOString?.() ?? row.scheduled_for,
    source: row.source,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    projections: projections.map((projection) => ({
      id: projection.id,
      provider: projection.provider,
      status: projection.status,
      attemptCount: projection.attempt_count,
      platformPostId: projection.platform_post_id ?? undefined,
      platformPostUrl: projection.platform_post_url ?? undefined,
      errorCategory: projection.error_category ?? undefined,
      errorSummary: projection.error_summary ?? undefined,
    })),
  };
}
