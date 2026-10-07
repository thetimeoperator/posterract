/**
 * Posting: publish now or schedule a video to Instagram, TikTok, Facebook and
 * Threads. create_post always previews first; it posts only when called
 * again with confirm: true, after the user has seen what will go out.
 *
 * TikTok posts go to Everyone unless the user asks for a smaller audience (a
 * private account can't: it gets the widest audience it allows). The preview
 * shows the TikTok account's name, the settings and TikTok's declaration.
 */

import { defaultTikTokPrivacy, validateTikTokOptions } from "@posterract/contract/tiktok";
import { CONNECTOR_PLATFORMS, PLATFORM_NAMES, ToolError, UUID, parseWhen } from "../context.js";
import { loadTargets } from "./accounts.js";

const platformList = { type: "string", enum: CONNECTOR_PLATFORMS };

/** Who can watch a TikTok post, in the words the user and agent use. */
const TIKTOK_PRIVACY = {
  everyone: "PUBLIC_TO_EVERYONE",
  friends: "MUTUAL_FOLLOW_FRIENDS",
  followers: "FOLLOWER_OF_CREATOR",
  only_me: "SELF_ONLY",
};
const PRIVACY_NAMES = Object.fromEntries(Object.entries(TIKTOK_PRIVACY).map(([name, level]) => [level, name]));
const MUSIC_USAGE = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED_CONTENT = "https://www.tiktok.com/legal/page/global/bc-policy/en";

const tiktokSettings = {
  type: "object",
  description:
    "Optional. A TikTok post goes to everyone by default; set these only when the user asks for something else. " +
    "The preview lists what each TikTok account allows.",
  properties: {
    privacy: {
      type: "string",
      enum: Object.keys(TIKTOK_PRIVACY),
      description: "Who can watch. Defaults to everyone (a private account: the widest audience it allows).",
    },
    allow_comments: { type: "boolean", description: "Let people comment. Off unless the user turns it on." },
    allow_duet: { type: "boolean", description: "Let people Duet the video. Off unless the user turns it on." },
    allow_stitch: { type: "boolean", description: "Let people Stitch the video. Off unless the user turns it on." },
    your_brand: {
      type: "boolean",
      description: "It promotes the user's own business, product or brand. TikTok labels it \"Promotional content\".",
    },
    branded_content: {
      type: "boolean",
      description: "It promotes another brand, e.g. a paid partnership. TikTok labels it \"Paid partnership\". Can't be only_me.",
    },
    ai_generated: { type: "boolean", description: "The video is AI-generated. TikTok labels it as AI-generated." },
    send_to_inbox: {
      type: "boolean",
      description: "true sends the video to the user's TikTok inbox to finish posting in the TikTok app instead; the other settings are then chosen there.",
    },
  },
  additionalProperties: false,
};

/** The TikTok settings as the REST API takes them. */
function tiktokOptions(settings = {}) {
  if (settings.send_to_inbox === true) return { mode: "inbox" };
  const brandOrganic = settings.your_brand === true;
  const brandContent = settings.branded_content === true;
  return {
    mode: "direct",
    privacyLevel: TIKTOK_PRIVACY[settings.privacy] ?? "",
    allowComment: settings.allow_comments === true,
    allowDuet: settings.allow_duet === true,
    allowStitch: settings.allow_stitch === true,
    commercialContent: brandOrganic || brandContent,
    brandOrganic,
    brandContent,
    isAigc: settings.ai_generated === true,
  };
}

/** TikTok's own words for what posting means, which the user sees before approving. */
function tiktokDeclaration(options) {
  return options.brandContent
    ? `By posting, you agree to TikTok's Branded Content Policy (${BRANDED_CONTENT}) and Music Usage Confirmation (${MUSIC_USAGE}).`
    : `By posting, you agree to TikTok's Music Usage Confirmation (${MUSIC_USAGE}).`;
}

const interaction = (on, disabled) => (disabled ? "off (turned off in this account's TikTok settings)" : on ? "on" : "off");

/** What the preview says about one TikTok account, and what (if anything) still stands in the way. */
function tiktokPreview(info, options, durationMs) {
  const allowed = info.privacy_level_options.map((level) => PRIVACY_NAMES[level]).filter(Boolean);
  if (options.mode === "inbox") {
    return {
      account: info.creator_nickname,
      tiktok: {
        posting: "sent to the TikTok inbox; the user finishes it in the TikTok app",
        after_sending: "TikTok notifies the user. They choose the settings and post it there.",
      },
    };
  }
  const privacyLevel = options.privacyLevel || defaultTikTokPrivacy(info.privacy_level_options);
  const problem = validateTikTokOptions({ ...options, privacyLevel }, info, durationMs);
  return {
    account: info.creator_nickname,
    tiktok: {
      username: info.creator_username ? `@${info.creator_username}` : undefined,
      posting: "posted directly",
      who_can_watch: PRIVACY_NAMES[privacyLevel] ?? privacyLevel,
      choices: allowed,
      comments: interaction(options.allowComment, info.comment_disabled),
      duet: interaction(options.allowDuet, info.duet_disabled),
      stitch: interaction(options.allowStitch, info.stitch_disabled),
      label: options.brandContent
        ? "Paid partnership"
        : options.brandOrganic ? "Promotional content" : "none",
      ai_generated: options.isAigc,
      longest_video_seconds: info.max_video_post_duration_sec,
      declaration: tiktokDeclaration(options),
      after_posting: "TikTok can take a few minutes to process the video before it shows on the profile.",
    },
    ...(problem ? { problem } : {}),
  };
}

/** A post as the agent sees it: its status on each platform, with links. */
export function describePost(post) {
  return {
    post_id: post.id,
    title: post.title,
    status: post.status,
    when: post.scheduledFor,
    ...(post.caption !== undefined ? { caption: post.caption } : {}),
    platforms: (post.projections ?? []).map((projection) => ({
      platform: projection.provider,
      ...(projection.accountId ? { account_id: projection.accountId } : {}),
      status: projection.status,
      ...(projection.platformPostUrl ? { url: projection.platformPostUrl } : {}),
      ...(projection.errorSummary ? { problem: projection.errorSummary } : {}),
    })),
  };
}

async function loadVideo(context, videoId) {
  const result = await context.postgres.query(
    `select original_filename, status, duration_ms from media_assets
     where id = $1 and workspace_id = $2 and purged_at is null`,
    [videoId, context.workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new ToolError("That video isn't in the Posterract library. Use list_videos, or add one with import_video_from_url.");
  if (!["ready", "attached", "scheduled", "publishing"].includes(row.status)) {
    throw new ToolError("That video isn't ready to post yet. Finish its upload first.");
  }
  return { name: row.original_filename, durationMs: row.duration_ms ?? undefined };
}

/**
 * Works out which accounts a post goes to, checked against what's connected.
 * A business posts to all its connected accounts (a disconnected one is left
 * out); with account_ids too, to exactly those, which must be in it.
 */
async function resolveTargets(context, args) {
  const { accounts, businesses } = await loadTargets(context);
  let chosen;
  let business;
  if (args.business_id) {
    business = businesses.find((item) => item.id === args.business_id);
    if (!business) throw new ToolError("Couldn't find that business, or it has no Instagram, TikTok, Facebook or Threads accounts. Use list_accounts.");
    if (args.account_ids) {
      chosen = args.account_ids.map((id) => {
        const account = business.accounts.find((item) => item.id === id);
        if (!account) throw new ToolError(`Account ${id} isn't in ${business.name}. Use list_accounts.`);
        return account;
      });
    } else {
      chosen = business.accounts.filter((account) => account.status === "connected");
    }
  } else if (args.account_ids) {
    chosen = args.account_ids.map((id) => {
      const account = accounts.find((item) => item.id === id);
      if (!account) throw new ToolError(`Account ${id} isn't a connected Instagram, TikTok, Facebook or Threads account. Use list_accounts.`);
      return account;
    });
  } else {
    if (!args.platforms?.length) throw new ToolError("Say where to post: account_ids, a business_id, or platforms.");
    // Without explicit accounts, each platform uses its most recently connected account.
    chosen = CONNECTOR_PLATFORMS.filter((platform) => args.platforms.includes(platform)).map((platform) => {
      const account = accounts
        .filter((item) => item.provider === platform)
        .sort((left, right) => (right.lastHealthCheckAt ?? 0) - (left.lastHealthCheckAt ?? 0))[0];
      if (!account) throw new ToolError(`No ${PLATFORM_NAMES[platform]} account is connected. Connect one in Posterract → Social accounts.`);
      return account;
    });
  }
  if (args.platforms?.length && (args.account_ids || args.business_id)) {
    chosen = chosen.filter((account) => args.platforms.includes(account.provider));
  }
  if (chosen.length === 0) throw new ToolError("None of those accounts are on the platforms asked for.");
  const disconnected = chosen.filter((account) => account.status !== "connected");
  if (disconnected.length) {
    throw new ToolError(
      `${disconnected.map((account) => `${PLATFORM_NAMES[account.provider]} ${account.handle}`).join(", ")} needs reconnecting in Posterract → Social accounts.`,
    );
  }
  return { targets: chosen, business };
}

export const createPost = {
  name: "create_post",
  title: "Post or schedule a video",
  description:
    "Publishes a video now, or schedules it, on Instagram, TikTok, Facebook and/or Threads. Called without confirm " +
    "(or confirm: false) it only returns a preview and posts nothing. Show the preview to the user, and only " +
    "after they approve call it again with the same arguments and confirm: true. TikTok posts go public to " +
    "everyone unless the user asks otherwise (see tiktok). Posts earn points in the Posterract game; a TikTok " +
    "post set to only_me earns nothing.",
  scopes: ["posts:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      video_id: { type: "string", pattern: UUID, description: "The video to post, from list_videos, import_video_from_url or finish_video_upload." },
      caption: { type: "string", maxLength: 2200, description: "The caption for every platform, unless captions overrides it." },
      when: { type: "string", description: "\"now\", or an ISO 8601 date-time with a time-zone offset, e.g. 2026-10-02T18:00:00-07:00." },
      account_ids: { type: "array", items: { type: "string", pattern: UUID }, minItems: 1, maxItems: 30, uniqueItems: true, description: "Accounts to post to, from list_accounts. Several on one platform are fine (e.g. two Instagram accounts)." },
      business_id: { type: "string", pattern: UUID, description: "A business from list_accounts: posts to all its accounts. Add account_ids to post to only some of them." },
      platforms: { type: "array", items: platformList, minItems: 1, maxItems: CONNECTOR_PLATFORMS.length, uniqueItems: true, description: "Limit to these platforms. With no accounts given, posts to each platform's connected account." },
      captions: {
        type: "object",
        properties: Object.fromEntries(CONNECTOR_PLATFORMS.map((platform) => [platform, { type: "string", maxLength: 2200 }])),
        additionalProperties: false,
        description: "A different caption per platform, e.g. a shorter one for Threads.",
      },
      tiktok: tiktokSettings,
      title: { type: "string", maxLength: 200, description: "A name for the post in the Posterract calendar. Not published." },
      confirm: { type: "boolean", description: "true to actually post. Leave it out to get a preview first." },
    },
    required: ["video_id", "caption", "when"],
    additionalProperties: false,
  },
  async run(context, args) {
    const when = parseWhen(args.when);
    const [video, { targets, business }] = await Promise.all([loadVideo(context, args.video_id), resolveTargets(context, args)]);
    const captionFor = (platform) => args.captions?.[platform] ?? args.caption;
    if (args.caption.trim() === "" && targets.some((account) => !args.captions?.[account.provider])) {
      throw new ToolError("The caption is empty.");
    }
    const tiktokAccounts = targets.filter((account) => account.provider === "tiktok");
    const tiktok = tiktokOptions(args.tiktok);

    if (args.confirm !== true) {
      // TikTok's current settings for each account: its name, the audiences it allows, what it has turned off.
      const tiktokRows = new Map();
      for (const account of tiktokAccounts) {
        const info = await context.api("GET", `/v1/accounts/${account.id}/tiktok/creator-info`);
        tiktokRows.set(account.id, tiktokPreview(info, tiktok, video.durationMs));
      }
      const problems = [...tiktokRows.values()].filter((row) => row.problem);
      return {
        status: "preview — nothing has been posted",
        video: video.name,
        when: when === "now" ? "now" : when,
        ...(business ? { business: business.name } : {}),
        posting_to: targets.map((account) => ({
          platform: account.provider,
          account: account.handle,
          caption: captionFor(account.provider),
          ...(tiktokRows.get(account.id) ?? {}),
        })),
        next_step: problems.length
          ? "Not ready: sort out each problem with the user, then preview again."
          : "Show this to the user. If they approve, call create_post again with the same arguments and confirm: true.",
      };
    }

    if (tiktokAccounts.length && tiktok.mode === "direct" && !tiktok.privacyLevel) {
      // Everyone, unless the account is private: then the widest audience it allows.
      const info = await context.api("GET", `/v1/accounts/${tiktokAccounts[0].id}/tiktok/creator-info`);
      tiktok.privacyLevel = defaultTikTokPrivacy(info.privacy_level_options);
    }
    const platforms = [...new Set(targets.map((account) => account.provider))];
    const perPlatformFor = (platform) => (platform === "tiktok"
      // The user approved the preview, TikTok's declaration included.
      ? { caption: captionFor(platform), options: tiktok.mode === "direct" ? { ...tiktok, consentAccepted: true } : tiktok }
      : { caption: captionFor(platform) });
    const body = {
      artifactId: args.video_id,
      title: args.title ?? video.name,
      caption: args.caption,
      platforms,
      perPlatform: Object.fromEntries(platforms.map((platform) => [platform, perPlatformFor(platform)])),
      scheduledFor: when,
      accountIds: targets.map((account) => account.id),
      ...(business ? { businessId: business.id } : {}),
    };
    const created = await context.api("POST", "/v1/posts", {
      body,
      idempotencyKey: context.idempotencyKey("create_post", args),
    });
    const post = await context.api("GET", `/v1/posts/${created.id}`);
    const tiktokNote = tiktokAccounts.length
      ? tiktok.mode === "inbox"
        ? " TikTok gets it in the user's inbox; they finish posting in the TikTok app."
        : " TikTok can take a few minutes to process the video before it shows on the profile."
      : "";
    return {
      ...describePost(post),
      next_step:
        (when === "now"
          ? "Posterract is publishing it now. Check with get_post in a minute; its points show in get_my_rank as its stats come in."
          : "It's on the calendar. Posterract publishes it at that time; move it with reschedule_post or stop it with cancel_post.") + tiktokNote,
    };
  },
};

export const getPost = {
  name: "get_post",
  title: "Check a post",
  description: "Shows a post's status on each platform (scheduled, publishing, live or failed), with links to the live posts and any problem.",
  scopes: ["posts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: { post_id: { type: "string", pattern: UUID, description: "From create_post or list_schedule." } },
    required: ["post_id"],
    additionalProperties: false,
  },
  async run(context, args) {
    return describePost(await context.api("GET", `/v1/posts/${args.post_id}`));
  },
};

export const POSTING_TOOLS = [createPost, getPost];
