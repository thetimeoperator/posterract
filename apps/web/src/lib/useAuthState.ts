import { useConvexAuth } from "convex/react";
import { authClient } from "./authClient";

const POSTGRES_AUTH = Boolean(import.meta.env.VITE_API_URL);

/** Auth-state compatibility hook used during the Convex → PostgreSQL cutover. */
export function useAuthState() {
  if (POSTGRES_AUTH) {
    const session = authClient.useSession();
    return {
      isLoading: session.isPending,
      isAuthenticated: Boolean(session.data?.user),
    };
  }
  return useConvexAuth();
}
