import { createAuthClient } from "better-auth/react";
import type { BetterAuthClientPlugin } from "better-auth";
import { convexClient, crossDomainClient } from "@convex-dev/better-auth/client/plugins";

/** Better Auth client — talks to the auth endpoints on the Convex deployment. */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL as string,
  // Cast: minor type skew between better-auth 1.6.x and the component's
  // bundled plugin types; runtime contract is the documented one.
  plugins: [convexClient(), crossDomainClient() as unknown as BetterAuthClientPlugin],
});
