/**
 * Posting: publish now or schedule a video to Instagram, Facebook and
 * Threads. create_post always previews first; it posts only when called
 * again with confirm: true, after the user has seen what will go out.
 */

import { CONNECTOR_PLATFORMS, PLATFORM_NAMES, ToolError, UUID, parseWhen } from "../context.js";
import { loadTargets } from "./accounts.js";

const platformList = { type: "string", enum: CONNECTOR_PLATFORMS };

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

async function videoName(context, videoId) {
  const result = await context.postgres.query(
    `select original_filename, status from media_assets
     where id = $1 and workspace_id = $2 and purged_at is null`,
    [videoId, context.workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new ToolError("That video isn't in the Posterract library. Use list_videos, or add one with import_video_from_url.");
  if (!["ready", "attached", "scheduled", "publishing"].includes(row.status)) {
    throw new ToolError("That video isn't ready to post yet. Finish its upload first.");
  }
  return row.original_filename;
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
    if (!business) throw new ToolError("Couldn't find that business, or it has no Instagram, Facebook or Threads accounts. Use list_accounts.");
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
      if (!account) throw new ToolError(`Account ${id} isn't a connected Instagram, Facebook or Threads account. Use list_accounts.`);
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
    "Publishes a video now, or schedules it, on Instagram, Facebook and/or Threads. Called without confirm " +
    "(or confirm: false) it only returns a preview and posts nothing. Show the preview to the user, and only " +
    "after they approve call it again with the same arguments and confirm: true. Every post earns points in " +
    "the Posterract game.",
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
      platforms: { type: "array", items: platformList, minItems: 1, maxItems: 3, uniqueItems: true, description: "Limit to these platforms. With no accounts given, posts to each platform's connected account." },
      captions: {
        type: "object",
        properties: Object.fromEntries(CONNECTOR_PLATFORMS.map((platform) => [platform, { type: "string", maxLength: 2200 }])),
        additionalProperties: false,
        description: "A different caption per platform, e.g. a shorter one for Threads.",
      },
      title: { type: "string", maxLength: 200, description: "A name for the post in the Posterract calendar. Not published." },
      confirm: { type: "boolean", description: "true to actually post. Leave it out to get a preview first." },
    },
    required: ["video_id", "caption", "when"],
    additionalProperties: false,
  },
  async run(context, args) {
    const when = parseWhen(args.when);
    const [video, { targets, business }] = await Promise.all([videoName(context, args.video_id), resolveTargets(context, args)]);
    const captionFor = (platform) => args.captions?.[platform] ?? args.caption;
    if (args.caption.trim() === "" && targets.some((account) => !args.captions?.[account.provider])) {
      throw new ToolError("The caption is empty.");
    }

    if (args.confirm !== true) {
      return {
        status: "preview — nothing has been posted",
        video,
        when: when === "now" ? "now" : when,
        ...(business ? { business: business.name } : {}),
        posting_to: targets.map((account) => ({
          platform: account.provider,
          account: account.handle,
          caption: captionFor(account.provider),
        })),
        next_step: "Show this to the user. If they approve, call create_post again with the same arguments and confirm: true.",
      };
    }

    const platforms = [...new Set(targets.map((account) => account.provider))];
    const body = {
      artifactId: args.video_id,
      title: args.title ?? video,
      caption: args.caption,
      platforms,
      perPlatform: Object.fromEntries(platforms.map((platform) => [platform, { caption: captionFor(platform) }])),
      scheduledFor: when,
      accountIds: targets.map((account) => account.id),
      ...(business ? { businessId: business.id } : {}),
    };
    const created = await context.api("POST", "/v1/posts", {
      body,
      idempotencyKey: context.idempotencyKey("create_post", args),
    });
    const post = await context.api("GET", `/v1/posts/${created.id}`);
    return {
      ...describePost(post),
      next_step:
        when === "now"
          ? "Posterract is publishing it now. Check with get_post in a minute; its points show in get_my_rank as its stats come in."
          : "It's on the calendar. Posterract publishes it at that time; move it with reschedule_post or stop it with cancel_post.",
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
