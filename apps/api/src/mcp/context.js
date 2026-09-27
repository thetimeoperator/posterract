/**
 * What every MCP tool gets: the caller's workspace, the database, and `api`,
 * which calls Posterract's own REST API in-process with the caller's
 * credentials. Tools are thin on purpose: permissions, plan checks, rate
 * limits, validation and duplicate-post protection all stay in the REST
 * routes, so an agent can never do more than the same key could over HTTP.
 */

import { createHash } from "node:crypto";

/** A failure the agent should read and act on; its message is shown to it verbatim. */
export class ToolError extends Error {}

/** Platforms reachable through the connector. TikTok and YouTube wait on their API approvals. */
export const CONNECTOR_PLATFORMS = ["instagram", "facebook", "threads"];
export const PLATFORM_NAMES = { instagram: "Instagram", facebook: "Facebook", threads: "Threads" };

export const UUID = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

// Plain-language versions of the REST API's error codes.
const API_ERRORS = {
  unauthorized: "Posterract no longer accepts this connection. Connect Posterract again (or use a new API key).",
  insufficient_scope: "This connection isn't allowed to do that. Connect Posterract again and allow it (or use an API key with that permission).",
  subscription_required: "This needs an active Posterract plan.",
  rate_limit_exceeded: "Too many requests right now. Wait a minute and try again.",
  post_not_found: "Couldn't find that post. Use list_schedule to find its id.",
  projection_not_found: "Couldn't find that platform post.",
  upload_not_found: "Couldn't find that upload. Start again with start_video_upload.",
  media_not_ready: "That video isn't ready to post yet. Finish its upload first, or pick another from list_videos.",
  media_in_use: "That video is still used by a scheduled post.",
  invalid_artifact_id: "That video id isn't valid. Pick one from list_videos.",
  invalid_caption: "The caption is missing.",
  caption_too_long: "The caption is too long for that platform.",
  invalid_scheduled_for: "Give the time as an ISO 8601 date-time with a time-zone offset, in the future, or \"now\".",
  scheduled_for_in_past: "That time has already passed. Pick a time in the future.",
  invalid_platforms: "Choose Instagram, Facebook or Threads.",
  duplicate_platform: "Each platform can only be listed once.",
  invalid_account_ids: "Those account ids aren't valid. Use list_accounts.",
  invalid_business_id: "That business id isn't valid. Use list_accounts.",
  business_not_found: "Couldn't find that business. Use list_accounts.",
  account_not_in_business: "Some of those accounts aren't in that business. Use list_accounts.",
  one_account_per_platform: "That platform takes one account per post.",
  invalid_scope: "Those accounts aren't connected, or aren't in that business. Use list_accounts.",
  idempotency_key_reused: "That exact request was just made with different details. Wait a few minutes and try again.",
  request_in_progress: "That request is still being processed. Check back in a moment.",
  invalid_upload_request: "That upload doesn't look right: send an MP4 or MOV up to 5 GB, with its exact size in bytes.",
  invalid_parts: "The upload's ETag is missing or wrong. Send the ETag header the upload returned.",
  invalid_schedule_range: "That date range is invalid; it can span at most 180 days.",
  invalid_analytics_range: "Use a range of 7, 30 or 90 days, or total.",
  post_has_no_media: "That post has no video to copy.",
};

function explainApiError(statusCode, body) {
  const code = typeof body?.error === "string" ? body.error : undefined;
  if (code && API_ERRORS[code]) {
    const details = body.details?.provider ? ` (${PLATFORM_NAMES[body.details.provider] ?? body.details.provider})` : "";
    const maximum = body.details?.maximum ? ` The limit is ${body.details.maximum} characters.` : "";
    return `${API_ERRORS[code]}${details}${maximum}`;
  }
  if (statusCode === 402 || statusCode === 403) return API_ERRORS.subscription_required;
  if (statusCode === 404) return "Posterract couldn't find that.";
  if (statusCode === 429) return API_ERRORS.rate_limit_exceeded;
  if (statusCode >= 500) return "Posterract hit an error on its side. Try again in a minute.";
  return `Posterract couldn't do that (${code ?? `HTTP ${statusCode}`}).`;
}

/** Calls a REST route in-process as the MCP caller. Throws a ToolError on failure. */
async function callApi(app, request, method, url, { body, idempotencyKey } = {}) {
  const headers = { authorization: request.headers.authorization ?? "" };
  if (request.headers.cookie) headers.cookie = request.headers.cookie;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) });
  let data;
  try {
    data = response.body ? JSON.parse(response.body) : undefined;
  } catch {
    data = undefined;
  }
  if (response.statusCode >= 400) throw new ToolError(explainApiError(response.statusCode, data));
  return data;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function toolContext(request, deps) {
  const workspaceId = request.authContext?.workspaceId;
  return {
    workspaceId,
    postgres: deps.postgres,
    log: request.log,
    api: (method, url, options) => callApi(deps.app, request, method, url, options),
    /**
     * A duplicate-post guard for write tools. The same tool with the same
     * arguments inside ten minutes gets the same key, so an agent retrying
     * after a timeout replays the first result instead of posting twice.
     */
    idempotencyKey(toolName, args) {
      const { confirm: _confirm, ...rest } = args ?? {};
      const window = Math.floor(Date.now() / 600_000);
      const digest = createHash("sha256")
        .update(`${workspaceId}:${toolName}:${stableJson(rest)}:${window}`)
        .digest("hex");
      return `mcp-${digest.slice(0, 40)}`;
    },
  };
}

/** Whether the caller's key or sign-in allows a tool: any one of its scopes, or a session. */
export function callerCan(request, tool) {
  const context = request.authContext;
  if (!context || context.kind !== "api_key") return Boolean(context);
  const scopes = context.scopes ?? [];
  return scopes.includes("*") || tool.scopes.some((scope) => scopes.includes(scope));
}

/**
 * Checks arguments against a tool's input schema (the subset tools use:
 * object, string, integer, number, boolean, array, enum, pattern, lengths,
 * bounds, required). Returns a message for the agent, or undefined.
 */
export function validateArgs(schema, args, path = "arguments") {
  if (schema.type === "object") {
    if (!args || typeof args !== "object" || Array.isArray(args)) return `${path} must be an object.`;
    for (const key of schema.required ?? []) {
      if (args[key] === undefined || args[key] === null) return `${key} is required.`;
    }
    for (const [key, value] of Object.entries(args)) {
      const property = schema.properties?.[key];
      if (!property) {
        if (schema.additionalProperties === false) return `Unknown argument: ${key}.`;
        continue;
      }
      if (value === undefined || value === null) continue;
      const problem = validateArgs(property, value, key);
      if (problem) return problem;
    }
    return undefined;
  }
  if (schema.type === "string") {
    if (typeof args !== "string") return `${path} must be text.`;
    if (schema.enum && !schema.enum.includes(args)) return `${path} must be one of: ${schema.enum.join(", ")}.`;
    if (schema.minLength && args.length < schema.minLength) return `${path} is too short.`;
    if (schema.maxLength && args.length > schema.maxLength) return `${path} is too long (at most ${schema.maxLength} characters).`;
    if (schema.pattern && !new RegExp(schema.pattern).test(args)) return `${path} isn't in the right format.`;
    return undefined;
  }
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof args !== "number" || !Number.isFinite(args)) return `${path} must be a number.`;
    if (schema.type === "integer" && !Number.isInteger(args)) return `${path} must be a whole number.`;
    if (schema.minimum !== undefined && args < schema.minimum) return `${path} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && args > schema.maximum) return `${path} must be at most ${schema.maximum}.`;
    return undefined;
  }
  if (schema.type === "boolean") {
    return typeof args === "boolean" ? undefined : `${path} must be true or false.`;
  }
  if (schema.type === "array") {
    if (!Array.isArray(args)) return `${path} must be a list.`;
    if (schema.minItems && args.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s).`;
    if (schema.maxItems && args.length > schema.maxItems) return `${path} can have at most ${schema.maxItems} items.`;
    if (schema.uniqueItems && new Set(args).size !== args.length) return `${path} has duplicates.`;
    for (const item of args) {
      const problem = validateArgs(schema.items ?? {}, item, `${path} item`);
      if (problem) return problem;
    }
    return undefined;
  }
  return undefined;
}


/** Parses "now" or an ISO 8601 date-time with an explicit time zone, for post times. */
export function parseWhen(when) {
  if (when === "now") return "now";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(when)) {
    throw new ToolError("Give the time as \"now\" or an ISO 8601 date-time with a time-zone offset, e.g. 2026-10-02T18:00:00-07:00.");
  }
  const at = new Date(when);
  if (!Number.isFinite(at.getTime())) throw new ToolError("That date-time isn't valid.");
  if (at.getTime() < Date.now() + 60_000) throw new ToolError("That time has already passed. Pick a time in the future, or \"now\".");
  return at.toISOString();
}
