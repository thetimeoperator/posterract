import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  httpAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

const vMetaProvider = v.union(v.literal("instagram"), v.literal("threads"));
type MetaProvider = "instagram" | "threads";
type CallbackKind = "deauthorize" | "data-deletion";

class CallbackError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function secretFor(provider: MetaProvider): string {
  const secret =
    provider === "instagram"
      ? process.env.INSTAGRAM_APP_SECRET
      : process.env.THREADS_APP_SECRET;
  if (!secret) throw new CallbackError(`${provider} callback is not configured`, 503);
  return secret;
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const decoded = atob(padded);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new CallbackError("Malformed signed request", 400);
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signaturesMatch(received: Uint8Array, expected: Uint8Array): boolean {
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < received.length; index += 1) {
    mismatch |= received[index]! ^ expected[index]!;
  }
  return mismatch === 0;
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function readSignedRequest(request: Request): Promise<string> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new CallbackError("Request too large", 413);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      const value = (await request.formData()).get("signed_request");
      if (typeof value === "string" && value.length <= 64 * 1024) return value;
    } catch {
      throw new CallbackError("Malformed callback form", 400);
    }
  } else {
    const body = await request.text();
    if (body.length > 64 * 1024) throw new CallbackError("Request too large", 413);
    const value = new URLSearchParams(body).get("signed_request");
    if (value) return value;
  }
  throw new CallbackError("Missing signed_request", 400);
}

async function verifySignedRequest(
  request: Request,
  provider: MetaProvider,
): Promise<{ userId: string; issuedAt: number }> {
  const signedRequest = await readSignedRequest(request);
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CallbackError("Malformed signed request", 400);
  }

  const [encodedSignature, encodedPayload] = parts;
  const receivedSignature = base64UrlBytes(encodedSignature);
  const expectedSignature = await hmac(secretFor(provider), encodedPayload);
  if (!signaturesMatch(receivedSignature, expectedSignature)) {
    throw new CallbackError("Invalid signed request", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlBytes(encodedPayload)));
  } catch {
    throw new CallbackError("Malformed signed request payload", 400);
  }
  if (!payload || typeof payload !== "object") {
    throw new CallbackError("Malformed signed request payload", 400);
  }

  const algorithm = "algorithm" in payload ? payload.algorithm : undefined;
  const userId = "user_id" in payload ? payload.user_id : undefined;
  const issuedAt = "issued_at" in payload ? payload.issued_at : undefined;
  if (typeof algorithm !== "string" || algorithm.toUpperCase() !== "HMAC-SHA256") {
    throw new CallbackError("Unsupported signed request algorithm", 400);
  }
  if (typeof userId !== "string" || userId.length === 0 || userId.length > 256) {
    throw new CallbackError("Missing signed request user", 400);
  }
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt) || issuedAt <= 0) {
    throw new CallbackError("Missing signed request timestamp", 400);
  }
  return { userId, issuedAt };
}

async function requestKey(
  provider: MetaProvider,
  userId: string,
  issuedAt: number,
): Promise<string> {
  const digest = await hmac(
    secretFor(provider),
    `posterract-meta-deletion:${provider}:${userId}:${issuedAt}`,
  );
  return bytesToHex(digest);
}

function confirmationCode(): string {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return `PRT${bytesToHex(random).toUpperCase()}`;
}

function statusUrl(code: string): string {
  const base = process.env.SITE_URL ?? "https://www.posterract.app";
  const url = new URL("/data-deletion", base);
  url.searchParams.set("code", code);
  return url.toString();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const findConnections = internalQuery({
  args: { provider: vMetaProvider, providerUserId: v.string() },
  handler: async (ctx, args) => {
    const portals = await ctx.db
      .query("portals")
      .withIndex("by_provider_account", (index) =>
        index.eq("provider", args.provider).eq("providerAccountId", args.providerUserId),
      )
      .collect();
    return portals.map((portal) => ({
      portalId: portal._id,
      workspaceId: portal.workspaceId,
      provider: args.provider,
    }));
  },
});

export const scrubPlatformDerivedData = internalMutation({
  args: {
    portalId: v.id("portals"),
    workspaceId: v.id("workspaces"),
    provider: vMetaProvider,
  },
  handler: async (ctx, args) => {
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_workspace", (index) => index.eq("workspaceId", args.workspaceId))
      .filter((filter) =>
        filter.and(
          filter.eq(filter.field("provider"), args.provider),
          filter.eq(filter.field("portalId"), args.portalId),
        ),
      )
      .collect();

    const projectionIds = new Set<string>();
    for (const projection of projections) {
      projectionIds.add(projection._id);
      const interrupted = [
        "pending",
        "scheduled",
        "uploading",
        "publishing",
        "processing",
        "retrying",
      ].includes(projection.status);
      await ctx.db.patch(projection._id, {
        platformPostId: undefined,
        platformPostUrl: undefined,
        pendingContainerId: undefined,
        ...(interrupted
          ? {
              status: "needs_reauth" as const,
              errorCategory: "authorization",
              errorSummary: `${args.provider} authorization was removed`,
            }
          : {}),
      });
    }

    const events = await ctx.db
      .query("events")
      .withIndex("by_workspace", (index) => index.eq("workspaceId", args.workspaceId))
      .collect();
    for (const event of events) {
      const isProjectionEvent =
        event.projectionId !== undefined && projectionIds.has(event.projectionId);
      const isConnectionEvent =
        event.type === "portal.connected" &&
        event.message.toLowerCase().startsWith(`${args.provider} connected`);
      if (isProjectionEvent || isConnectionEvent) await ctx.db.delete(event._id);
    }
  },
});

export const beginDeletion = internalMutation({
  args: {
    provider: vMetaProvider,
    requestKey: v.string(),
    confirmationCode: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("metaDeletionRequests")
      .withIndex("by_request_key", (index) => index.eq("requestKey", args.requestKey))
      .first();
    if (existing) return existing;

    const id = await ctx.db.insert("metaDeletionRequests", {
      provider: args.provider,
      requestKey: args.requestKey,
      confirmationCode: args.confirmationCode,
      status: "processing",
      deletedConnections: 0,
      requestedAt: Date.now(),
    });
    const created = await ctx.db.get(id);
    if (!created) throw new Error("Could not create deletion receipt");
    return created;
  },
});

export const completeDeletion = internalMutation({
  args: {
    requestId: v.id("metaDeletionRequests"),
    deletedConnections: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Deletion receipt missing");
    if (request.status !== "completed") {
      await ctx.db.patch(args.requestId, {
        status: "completed",
        deletedConnections: Math.max(request.deletedConnections, args.deletedConnections),
        completedAt: Date.now(),
      });
    }
    return request.confirmationCode;
  },
});

export const getDeletionStatus = query({
  args: { confirmationCode: v.string() },
  handler: async (ctx, args) => {
    if (!/^PRT[A-F0-9]{32}$/.test(args.confirmationCode)) return null;
    const request = await ctx.db
      .query("metaDeletionRequests")
      .withIndex("by_confirmation_code", (index) =>
        index.eq("confirmationCode", args.confirmationCode),
      )
      .first();
    if (!request) return null;
    return {
      provider: request.provider,
      status: request.status,
      requestedAt: request.requestedAt,
      completedAt: request.completedAt,
    };
  },
});

async function clearConnections(
  ctx: ActionCtx,
  provider: MetaProvider,
  providerUserId: string,
  scrubPlatformData: boolean,
): Promise<number> {
  const connections = await ctx.runQuery(internal.metaCallbacks.findConnections, {
    provider,
    providerUserId,
  });
  for (const connection of connections) {
    if (scrubPlatformData) {
      await ctx.runMutation(internal.metaCallbacks.scrubPlatformDerivedData, connection);
    }
    await ctx.runMutation(internal.oauth.clearConnection, connection);
  }
  return connections.length;
}

async function handleCallback(
  ctx: ActionCtx,
  request: Request,
  provider: MetaProvider,
  kind: CallbackKind,
): Promise<Response> {
  try {
    const { userId, issuedAt } = await verifySignedRequest(request, provider);
    if (kind === "deauthorize") {
      await clearConnections(ctx, provider, userId, false);
      return new Response(null, {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    }

    const key = await requestKey(provider, userId, issuedAt);
    const receipt = await ctx.runMutation(internal.metaCallbacks.beginDeletion, {
      provider,
      requestKey: key,
      confirmationCode: confirmationCode(),
    });
    if (receipt.status !== "completed") {
      const deletedConnections = await clearConnections(ctx, provider, userId, true);
      await ctx.runMutation(internal.metaCallbacks.completeDeletion, {
        requestId: receipt._id as Id<"metaDeletionRequests">,
        deletedConnections,
      });
    }
    return json({
      url: statusUrl(receipt.confirmationCode),
      confirmation_code: receipt.confirmationCode,
    });
  } catch (error) {
    const status = error instanceof CallbackError ? error.status : 500;
    const message = status >= 500 ? "Callback processing failed" : "Invalid callback request";
    return json({ error: message }, status);
  }
}

export const threadsDeauthorize = httpAction((ctx, request) =>
  handleCallback(ctx, request, "threads", "deauthorize"),
);

export const threadsDataDeletion = httpAction((ctx, request) =>
  handleCallback(ctx, request, "threads", "data-deletion"),
);

export const instagramDeauthorize = httpAction((ctx, request) =>
  handleCallback(ctx, request, "instagram", "deauthorize"),
);

export const instagramDataDeletion = httpAction((ctx, request) =>
  handleCallback(ctx, request, "instagram", "data-deletion"),
);
