/**
 * The calendar: what's scheduled and what went out, and moving, cancelling,
 * copying and retrying posts.
 */

import { ToolError, UUID, parseWhen } from "../context.js";
import { describePost } from "./posting.js";

const postId = { type: "string", pattern: UUID, description: "From list_schedule or create_post." };
const DAY = 86_400_000;

export const listSchedule = {
  name: "list_schedule",
  title: "Show the posting calendar",
  description:
    "Lists posts in a date range: scheduled ones and ones already published or failed, with each platform's status. " +
    "Defaults to yesterday through the next 30 days; a range can span up to 180 days.",
  scopes: ["posts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Start, as an ISO 8601 date-time. Defaults to 24 hours ago." },
      to: { type: "string", description: "End, as an ISO 8601 date-time. Defaults to 30 days from now." },
    },
    additionalProperties: false,
  },
  async run(context, args) {
    const from = args.from ? new Date(args.from) : new Date(Date.now() - DAY);
    const to = args.to ? new Date(args.to) : new Date(Date.now() + 30 * DAY);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      throw new ToolError("from and to must be ISO 8601 date-times.");
    }
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    const { transmissions } = await context.api("GET", `/v1/schedule?${query}`);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      count: transmissions.length,
      posts: transmissions.map((post) => {
        const { caption: _caption, ...summary } = describePost(post);
        return summary;
      }),
    };
  },
};

export const reschedulePost = {
  name: "reschedule_post",
  title: "Move a scheduled post",
  description: "Moves a scheduled post to a new date and time. Only posts that haven't gone out yet can be moved.",
  scopes: ["posts:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      post_id: postId,
      when: { type: "string", description: "The new time: an ISO 8601 date-time with a time-zone offset." },
    },
    required: ["post_id", "when"],
    additionalProperties: false,
  },
  async run(context, args) {
    const when = parseWhen(args.when);
    if (when === "now") throw new ToolError("To post right away, cancel this post and create it again with when: \"now\".");
    await context.api("POST", `/v1/posts/${args.post_id}/reschedule`, {
      body: { scheduledFor: when },
      idempotencyKey: context.idempotencyKey("reschedule_post", args),
    });
    return describePost(await context.api("GET", `/v1/posts/${args.post_id}`));
  },
};

export const cancelPost = {
  name: "cancel_post",
  title: "Cancel a scheduled post",
  description:
    "Cancels a scheduled post so it never goes out. Posts that are already live stay live. Without confirm it only " +
    "describes the post; call again with confirm: true once the user agrees.",
  scopes: ["posts:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      post_id: postId,
      confirm: { type: "boolean", description: "true to cancel. Leave it out to see the post first." },
    },
    required: ["post_id"],
    additionalProperties: false,
  },
  async run(context, args) {
    const post = describePost(await context.api("GET", `/v1/posts/${args.post_id}`));
    if (args.confirm !== true) {
      return { status: "not cancelled yet", post, next_step: "Confirm with the user, then call cancel_post again with confirm: true." };
    }
    await context.api("POST", `/v1/posts/${args.post_id}/cancel`, {
      idempotencyKey: context.idempotencyKey("cancel_post", args),
    });
    return describePost(await context.api("GET", `/v1/posts/${args.post_id}`));
  },
};

export const duplicatePost = {
  name: "duplicate_post",
  title: "Copy a post",
  description:
    "Copies a post (same video, captions and accounts) and schedules the copy for one hour from now. Move it with " +
    "reschedule_post afterwards. Without confirm it only describes what would be copied.",
  scopes: ["posts:write"],
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: {
      post_id: postId,
      confirm: { type: "boolean", description: "true to make the copy." },
    },
    required: ["post_id"],
    additionalProperties: false,
  },
  async run(context, args) {
    if (args.confirm !== true) {
      const post = describePost(await context.api("GET", `/v1/posts/${args.post_id}`));
      return {
        status: "not copied yet",
        post,
        next_step: "The copy would publish one hour from now. Confirm with the user, then call again with confirm: true.",
      };
    }
    const copy = await context.api("POST", `/v1/posts/${args.post_id}/duplicate`, {
      idempotencyKey: context.idempotencyKey("duplicate_post", args),
    });
    return describePost(await context.api("GET", `/v1/posts/${copy.id}`));
  },
};

export const retryPost = {
  name: "retry_post",
  title: "Retry a failed post",
  description: "Retries the platforms where a post failed. Platforms where it's already live are left alone.",
  scopes: ["posts:write"],
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  inputSchema: {
    type: "object",
    properties: { post_id: postId },
    required: ["post_id"],
    additionalProperties: false,
  },
  async run(context, args) {
    const post = await context.api("GET", `/v1/posts/${args.post_id}`);
    const failed = (post.projections ?? []).filter((projection) => ["failed", "needs_reauth", "blocked"].includes(projection.status));
    if (failed.length === 0) return { ...describePost(post), note: "Nothing to retry: no platform failed." };
    for (const projection of failed) {
      await context.api("POST", `/v1/projections/${projection.id}/retry`, {
        idempotencyKey: context.idempotencyKey("retry_post", { ...args, projection: projection.id }),
      });
    }
    return {
      ...describePost(await context.api("GET", `/v1/posts/${args.post_id}`)),
      retried: failed.map((projection) => projection.provider),
    };
  },
};

export const CALENDAR_TOOLS = [listSchedule, reschedulePost, cancelPost, duplicatePost, retryPost];
