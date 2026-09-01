import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth";
import { magicLinkClient } from "better-auth/client/plugins";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

/** Better Auth client — uses the Postgres API in production and Convex locally. */
const postgresAuth = Boolean(import.meta.env.VITE_API_URL);
const postgresApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const browserOrigin = ["http:", "https:"].includes(window.location.protocol)
  ? window.location.origin
  : "https://api.posterract.app";
const postgresAuthUrl = postgresApiUrl?.endsWith("/api")
  ? postgresApiUrl.slice(0, -4) || browserOrigin
  : postgresApiUrl;

/** Same-origin/public API base used for unauthenticated capability checks. */
export const posterractApiUrl = postgresAuthUrl;

export const authClient = createAuthClient({
  baseURL: (postgresAuth
    ? postgresAuthUrl
    : import.meta.env.VITE_CONVEX_SITE_URL) as string,
  // Cast: minor type skew between better-auth 1.6.x and the component's
  // bundled plugin types; runtime contract is the documented one.
  plugins: postgresAuth
    ? [magicLinkClient()]
    : [convexClient(), crossDomainClient() as unknown as BetterAuthClientPlugin],
});
