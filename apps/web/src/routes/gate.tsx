import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShaderBackground } from "@/components/ui/blue-noise";
import { WelcomeAuthCard } from "@/components/ui/welcome-auth-card";
import { ENGINE_MODE } from "@/engine/useEngine";
import { useAuthState } from "@/lib/useAuthState";

/** `?mode=signup` opens the card on sign-up; anything else, or nothing, opens sign-in. */
type GateSearch = { mode?: "signin" | "signup" };

export const Route = createFileRoute("/gate")({
  validateSearch: (search: Record<string, unknown>): GateSearch =>
    search.mode === "signup" || search.mode === "signin" ? { mode: search.mode } : {},
  component: Gate,
});

/** Shared welcome screen for direct authentication deep links. */
function Gate() {
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const { isAuthenticated } = useAuthState();

  if (ENGINE_MODE === "demo" || isAuthenticated) {
    return <Navigate to="/" />;
  }

  return (
    <main className="welcome-auth-gate">
      <div className="welcome-auth-gate-background" aria-hidden="true">
        <ShaderBackground className="welcome-auth-gate-canvas" />
        <div className="welcome-auth-gate-shade" />
      </div>
      <div className="welcome-auth-gate-card">
        <WelcomeAuthCard initialMode={mode ?? "signin"} onSuccess={() => void navigate({ to: "/" })} />
      </div>
    </main>
  );
}
