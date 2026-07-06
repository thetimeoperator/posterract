import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

// Convex runtime provides process.env; declare for app-side typechecking.
declare const process: { env: Record<string, string | undefined> };

/** Canonical app origin (cookies/redirects) — e.g. https://posterract.app */
const siteUrl = process.env.SITE_URL!;
/** Extra origins allowed to authenticate (comma-separated), e.g. the .vercel.app URL. */
const extraOrigins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl, ...extraOrigins],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });
};

/** The signed-in user (null when logged out). */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => (await authComponent.safeGetAuthUser(ctx)) ?? null,
});
