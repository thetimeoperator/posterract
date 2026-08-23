import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({ component: CalendarHome });

/** The publishing calendar is the MVP signed-in home. */
function CalendarHome() {
  return <Navigate to="/continuum" replace />;
}
