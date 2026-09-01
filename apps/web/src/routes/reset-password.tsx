import { type FormEvent, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleCheck, Eye, EyeOff, LockKeyhole, MoveRight, ShieldAlert } from "lucide-react";
import { ShaderBackground } from "@/components/ui/blue-noise";
import { authClient } from "@/lib/authClient";
import "@/styles/welcome-auth.css";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = search.get("token") ?? "";
  const linkError = search.get("error");
  const invalidLink = !token || Boolean(linkError);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setError(result.error.message ?? "This reset link is invalid or has expired.");
        return;
      }
      setComplete(true);
    } catch {
      setError("Your password could not be reset. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="welcome-auth-gate">
      <div className="welcome-auth-gate-background" aria-hidden="true">
        <ShaderBackground className="welcome-auth-gate-canvas" />
        <div className="welcome-auth-gate-shade" />
      </div>
      <div className="welcome-auth-gate-card">
        <section className="welcome-auth-card welcome-reset-card">
          <div className="welcome-auth-beam" aria-hidden="true" />
          <div className="welcome-auth-noise" aria-hidden="true" />
          <div className="welcome-auth-topline">
            <span><i /> SECURE POSTERRACT ACCESS</span>
            <span>RECOVERY // 02</span>
          </div>
          <div className="welcome-auth-body">
            <div className="welcome-auth-brand">
              <div className="welcome-auth-mark" aria-hidden="true"><span>P</span></div>
              <p>POSTER<span>RACT</span></p>
            </div>
            <div className="welcome-auth-heading">
              <p className="site-kicker">CREDENTIAL RECOVERY</p>
              <h2>{complete ? "Access restored." : invalidLink ? "Link unavailable." : "Choose a new password."}</h2>
              <p>
                {complete
                  ? "Your password has been changed and your previous sessions have been closed."
                  : invalidLink
                    ? "This reset link is invalid or has expired. Request a fresh link from the sign-in screen."
                    : "Create a secure password with at least eight characters."}
              </p>
            </div>

            {complete ? (
              <div className="welcome-auth-confirmation">
                <span className="welcome-auth-confirmation-icon" aria-hidden="true">
                  <CircleCheck size={27} strokeWidth={1.55} />
                </span>
                <p>Password updated</p>
                <span>You can now sign in using your new credentials.</span>
                <button className="welcome-auth-submit" type="button" onClick={() => void navigate({ to: "/gate" })}>
                  <span>Continue to sign in</span>
                  <MoveRight aria-hidden="true" size={17} />
                </button>
              </div>
            ) : invalidLink ? (
              <div className="welcome-auth-confirmation">
                <span className="welcome-auth-confirmation-icon is-error" aria-hidden="true">
                  <ShieldAlert size={27} strokeWidth={1.55} />
                </span>
                <p>Secure token rejected</p>
                <span>Return to sign in and use “Forgot password?” to generate a new link.</span>
                <button className="welcome-auth-secondary" type="button" onClick={() => void navigate({ to: "/gate" })}>
                  Return to sign in
                </button>
              </div>
            ) : (
              <form className="welcome-auth-form" onSubmit={submit}>
                <label>
                  <span>New password</span>
                  <div className="welcome-auth-input">
                    <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.7} />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                    />
                    <button
                      type="button"
                      className="welcome-auth-password-toggle"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                    </button>
                  </div>
                </label>
                <label>
                  <span>Confirm password</span>
                  <div className="welcome-auth-input">
                    <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.7} />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      placeholder="Repeat new password"
                    />
                  </div>
                </label>
                {error && <p className="welcome-auth-error" role="alert">{error}</p>}
                <button className="welcome-auth-submit" type="submit" disabled={busy}>
                  <span>{busy ? "Updating credentials…" : "Set new password"}</span>
                  <MoveRight aria-hidden="true" size={17} />
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
