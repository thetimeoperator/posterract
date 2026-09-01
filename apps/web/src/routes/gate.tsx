import { Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShaderBackground } from "@/components/ui/blue-noise";
import { WelcomeAuthCard } from "@/components/ui/welcome-auth-card";
import { ENGINE_MODE } from "@/engine/useEngine";
import { useAuthState } from "@/lib/useAuthState";

export const Route = createFileRoute("/gate")({
  component: Gate,
});

/** Shared welcome screen for direct authentication deep links. */
function Gate() {
  const navigate = useNavigate();
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
        <WelcomeAuthCard onSuccess={() => void navigate({ to: "/" })} />
      </div>
    </main>
  );
}
