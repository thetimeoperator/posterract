import { useConvexAuth } from "convex/react";
import { authClient } from "./authClient";
import { isPosterractDesktop } from "./desktop";
import { useDesktopAuth } from "./desktopAuth";

const POSTGRES_AUTH = Boolean(import.meta.env.VITE_API_URL);
const CONVEX_AUTH = Boolean(import.meta.env.VITE_CONVEX_URL);

/** Auth-state compatibility hook used during the Convex → PostgreSQL cutover. */
export function useAuthState() {
  if (isPosterractDesktop()) {
    const desktop = useDesktopAuth();
    return {
      isLoading: desktop.status === "loading" || desktop.status === "authorizing",
      isAuthenticated: desktop.status === "signed_in",
      user: desktop.session?.user,
      error: desktop.error,
    };
  }
  if (POSTGRES_AUTH) {
    const session = authClient.useSession();
    return {
      isLoading: session.isPending,
      isAuthenticated: Boolean(session.data?.user),
      user: session.data?.user,
    };
  }
  // The deterministic demo/e2e build intentionally has no auth provider.
  // Treat it as its pre-authenticated local workspace instead of calling a
  // Convex hook without a ConvexProvider ancestor.
  if (!CONVEX_AUTH) {
    return {
      isLoading: false,
      isAuthenticated: true,
      user: undefined,
      error: undefined,
    };
  }
  const convex = useConvexAuth();
  return { ...convex, user: undefined, error: undefined };
}
