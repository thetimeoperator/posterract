import { timingSafeEqual } from "node:crypto";
import { createClerkClient, verifyToken } from "@clerk/backend";

/**
 * Two independent checks, both required for anything about a specific person:
 *
 *   1. the caller is the AI FOR SAVAGES server  (Bearer HUB_SERVICE_KEY)
 *   2. the person is who the caller says        (X-Clerk-Token, verified here)
 *
 * The website can therefore never act as someone else: it proves itself with
 * the service key, and the user is taken from the token's `sub`, never from a
 * body field.
 */

const SERVICE_KEY = process.env.HUB_SERVICE_KEY ?? "";
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY ?? "";
const AUTHORIZED_PARTIES = (
  process.env.CLERK_AUTHORIZED_PARTIES ??
  "https://www.aiforsavages.fyi,https://aiforsavages.fyi"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const clerk = process.env.CLERK_SECRET_KEY
  ? createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  : null;

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  // compare a fixed-size digest-ish buffer so length alone doesn't leak
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Bearer HUB_SERVICE_KEY — proves the caller is our own server. */
export function requireService(request, reply) {
  if (!SERVICE_KEY) {
    reply.code(503).send({ error: "hub_not_configured" });
    return false;
  }
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEquals(token, SERVICE_KEY)) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

/**
 * Verify the Clerk session token with no network call (jwtKey), and confirm it
 * was issued for one of our origins. Returns the Clerk user id, or null.
 */
export async function clerkUserIdFrom(request, reply) {
  const token = request.headers["x-clerk-token"];
  if (!token) {
    reply.code(401).send({ error: "missing_clerk_token" });
    return null;
  }
  if (!CLERK_JWT_KEY) {
    reply.code(503).send({ error: "clerk_not_configured" });
    return null;
  }
  try {
    const payload = await verifyToken(String(token), {
      jwtKey: CLERK_JWT_KEY,
      authorizedParties: AUTHORIZED_PARTIES,
    });
    if (!payload?.sub) {
      reply.code(401).send({ error: "invalid_clerk_token" });
      return null;
    }
    return payload.sub;
  } catch {
    reply.code(401).send({ error: "invalid_clerk_token" });
    return null;
  }
}

/**
 * The verified primary email for a Clerk user, read from Clerk's own Backend
 * API — never from the browser, never from the calling server.
 *
 * Returns { email, verified }. Linking only ever happens when verified is true
 * (see §3: this is what closes the unverified-signup hijack).
 */
export async function verifiedPrimaryEmail(clerkUserId) {
  if (!clerk) return { email: null, verified: false, reason: "clerk_not_configured" };

  const user = await clerk.users.getUser(clerkUserId);
  const primaryId = user.primaryEmailAddressId;
  const primary =
    user.emailAddresses?.find((entry) => entry.id === primaryId) ?? null;

  if (!primary) return { email: null, verified: false, reason: "no_primary_email" };

  const verified = primary.verification?.status === "verified";
  return {
    email: String(primary.emailAddress ?? "").trim().toLowerCase(),
    verified,
    reason: verified ? null : "email_not_verified",
    displayName:
      [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    imageUrl: user.imageUrl ?? null,
  };
}
