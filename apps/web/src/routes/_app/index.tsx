import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: ForgeHome });

/** The Forge is the signed-in product home. */
function ForgeHome() {
  return <Navigate to="/forge" replace />;
}
