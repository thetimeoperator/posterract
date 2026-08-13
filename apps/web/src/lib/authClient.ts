import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

/** Better Auth client — talks to the auth endpoints on the Convex deployment. */
const postgresAuth = Boolean(import.meta.env.VITE_API_URL);
const postgresApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
const postgresAuthUrl = postgresApiUrl?.endsWith("/api")
  ? postgresApiUrl.slice(0, -4) || window.location.origin
  : postgresApiUrl;

export const authClient = createAuthClient({
  baseURL: (postgresAuth
    ? postgresAuthUrl
    : import.meta.env.VITE_CONVEX_SITE_URL) as string,
  // Cast: minor type skew between better-auth 1.6.x and the component's
  // bundled plugin types; runtime contract is the documented one.
  plugins: postgresAuth
    ? []
    : [convexClient(), crossDomainClient() as unknown as BetterAuthClientPlugin],
});
