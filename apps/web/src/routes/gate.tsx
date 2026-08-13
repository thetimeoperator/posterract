import { useState } from "react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, GridHorizon, Input, MiniTesseract, Starfield } from "@posterract/hyperkit";
import { DeviceStage } from "@/core3d/DeviceStage";
import { authClient } from "@/lib/authClient";
import { ENGINE_MODE } from "@/engine/useEngine";
import { useAuthState } from "@/lib/useAuthState";

export const Route = createFileRoute("/gate")({
  component: Gate,
});

/**
 * The Gate — sign in / create account. The device idles behind the glass.
 */
function Gate() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthState();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Demo mode has no auth; already-authed users skip the gate.
  if (ENGINE_MODE === "demo" || isAuthenticated) {
    return <Navigate to="/" />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "That didn't work — check your details.");
      } else {
        void navigate({ to: "/" });
      }
    } catch {
      setError("Could not reach the gate. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="chamber relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="chamber-grid absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-0">
        <Starfield />
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden>
        <DeviceStage mode="idle" className="h-full w-full" />
      </div>
      <GridHorizon className="absolute" />

      <div className="glass hk-brackets relative z-10 w-full max-w-md rounded-[var(--radius-panel)] p-8">
        <span className="hk-bracket-b" aria-hidden />
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <MiniTesseract size={34} />
          <div>
            <p className="font-display text-[19px] font-bold tracking-[0.18em] text-starlight">
              POSTER<span className="text-neon">RACT</span>
            </p>
            <p className="mt-1 text-[12.5px] text-starlight-dim">
              {mode === "signin" ? "Open the gate." : "Claim your Posterract."}
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
          {mode === "signup" && (
            <Input
              label="Name"
              autoComplete="name"
              placeholder="What should we call you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder={mode === "signup" ? "8+ characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            {mode === "signin" ? "Enter" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === "signin" ? "signup" : "signin"));
            setError(null);
          }}
          className="mt-4 w-full text-center text-[12.5px] text-starlight-dim transition-colors hover:text-neon"
        >
          {mode === "signin" ? "New here? Create an account" : "Already aboard? Sign in"}
        </button>

        <p className="mt-6 text-center text-[10.5px] text-starlight-faint">
          One post. Six platforms. The fourth dimension is time.
        </p>

        <div className="mt-3 flex justify-center gap-4 text-[10.5px] text-starlight-faint">
          <Link to="/privacy" className="transition-colors hover:text-neon">
            Privacy
          </Link>
          <Link to="/terms" className="transition-colors hover:text-neon">
            Terms
          </Link>
        </div>
      </div>
    </main>
  );
}
