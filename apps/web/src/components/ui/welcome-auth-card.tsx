import {
  type PointerEvent as ReactPointerEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  MoveLeft,
  MoveRight,
  UserRound,
} from "lucide-react";
import { authClient, posterractApiUrl } from "@/lib/authClient";
import "@/styles/welcome-auth.css";

export type WelcomeAuthMode = "signin" | "signup";

type WelcomeAuthCardProps = {
  initialMode?: WelcomeAuthMode;
  onSuccess: () => void;
  onClose?: () => void;
  showClose?: boolean;
  successUrl?: string;
};

type BusyAction = "email" | "google" | "recovery" | "resend" | null;
type AuthView = "auth" | "forgot" | "recovery-sent" | "signin-sent" | "verify";

export function WelcomeAuthCard({
  initialMode = "signin",
  onSuccess,
  onClose,
  showClose = false,
  successUrl = "/",
}: WelcomeAuthCardProps) {
  const reduceMotion = useReducedMotion();
  const [mode, setMode] = useState<WelcomeAuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [emailVerificationEnabled, setEmailVerificationEnabled] = useState(false);
  const [magicLinkEnabled, setMagicLinkEnabled] = useState(Boolean(posterractApiUrl));
  const [view, setView] = useState<AuthView>("auth");
  const emailRef = useRef<HTMLInputElement>(null);

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, { stiffness: 230, damping: 26, mass: 0.55 });
  const y = useSpring(rawY, { stiffness: 230, damping: 26, mass: 0.55 });
  const rotateX = useTransform(y, [-0.5, 0.5], [3.2, -3.2]);
  const rotateY = useTransform(x, [-0.5, 0.5], [-3.2, 3.2]);

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setNotice(null);
    setView("auth");
  }, [initialMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => emailRef.current?.focus(), 90);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!posterractApiUrl) return;
    const controller = new AbortController();
    void fetch(`${posterractApiUrl}/v1/auth/config`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((config: { providers?: { emailVerification?: boolean; google?: boolean; magicLink?: boolean } } | undefined) => {
        setGoogleEnabled(config?.providers?.google === true);
        setEmailVerificationEnabled(config?.providers?.emailVerification === true);
        setMagicLinkEnabled(config?.providers?.magicLink === true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const setAuthMode = (nextMode: WelcomeAuthMode) => {
    setMode(nextMode);
    setError(null);
    setNotice(null);
    setView("auth");
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    rawX.set((event.clientX - rect.left) / rect.width - 0.5);
    rawY.set((event.clientY - rect.top) / rect.height - 0.5);
  };

  const settleCard = () => {
    rawX.set(0);
    rawY.set(0);
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy("email");
    try {
      if (mode === "signin" && magicLinkEnabled) {
        const result = await authClient.signIn.magicLink({
          email,
          callbackURL: new URL(successUrl, window.location.origin).toString(),
          errorCallbackURL: new URL(successUrl, window.location.origin).toString(),
        });
        if (result.error) {
          setError(result.error.message ?? "A secure sign-in link could not be sent.");
          return;
        }
        setView("signin-sent");
        return;
      }

      const result = mode === "signup"
        ? await authClient.signUp.email({
            email,
            password,
            name: name.trim() || email.split("@")[0],
          })
        : await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        const message = result.error.message ?? "Those details were not accepted.";
        setError(message);
        return;
      }
      if (mode === "signup" && emailVerificationEnabled) {
        setView("verify");
        return;
      }
      onSuccess();
    } catch {
      setError("The authentication service is unreachable. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const requestRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy("recovery");
    try {
      await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setView("recovery-sent");
    } catch {
      setError("Password recovery is temporarily unavailable. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const resendVerification = async () => {
    setError(null);
    setNotice(null);
    setBusy("resend");
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: new URL(successUrl, window.location.origin).toString(),
      });
      if (result.error) {
        setError(result.error.message ?? "A new verification email could not be sent.");
        return;
      }
      setNotice("A fresh secure link is on its way.");
    } catch {
      setError("A new verification email could not be sent. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const signInWithGoogle = async () => {
    setError(null);
    setBusy("google");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: new URL(successUrl, window.location.origin).toString(),
      });
      if (result?.error) {
        setError(result.error.message ?? "Google sign-in could not be started.");
        setBusy(null);
      }
    } catch {
      setError("Google sign-in could not be started. Try again in a moment.");
      setBusy(null);
    }
  };

  const heading =
    view === "forgot"
      ? {
          kicker: "CREDENTIAL RECOVERY",
          title: "Recover access.",
          copy: "Enter your account email and we’ll send a secure one-hour reset link.",
        }
      : view === "recovery-sent"
        ? {
            kicker: "RECOVERY SIGNAL SENT",
            title: "Check your inbox.",
            copy: "If an account exists for that address, its reset link is already on the way.",
          }
        : view === "signin-sent"
          ? {
              kicker: "SIGN-IN LINK SENT",
              title: "Check your inbox.",
              copy: "Use the secure link in your email to return to Posterract on this browser.",
            }
        : view === "verify"
          ? {
              kicker: "IDENTITY CONFIRMATION",
              title: "Verify your signal.",
              copy: "Open the secure link we sent to activate your Posterract workspace.",
            }
          : {
              kicker: "WELCOME TO THE NETWORK",
              title: mode === "signin" ? "Welcome back." : "Build your command center.",
              copy:
                mode === "signin"
                  ? "Enter your email and we’ll send a secure, single-use sign-in link."
                  : "Create the workspace that will hold your channels, posts, assets, and analytics.",
            };

  return (
    <motion.div
      className="welcome-auth-card"
      style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 1500 }}
      onPointerMove={handlePointerMove}
      onPointerLeave={settleCard}
      initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.99 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="welcome-auth-beam" aria-hidden="true" />
      <div className="welcome-auth-noise" aria-hidden="true" />

      <div className="welcome-auth-topline">
        <span><i /> SECURE POSTERRACT ACCESS</span>
        {showClose && onClose ? (
          <button type="button" onClick={onClose} aria-label="Close welcome screen">
            CLOSE <kbd>ESC</kbd>
          </button>
        ) : (
          <span>AUTH // 01</span>
        )}
      </div>

      <div className="welcome-auth-body">
        <div className="welcome-auth-brand">
          <div className="welcome-auth-mark" aria-hidden="true">
            <span>P</span>
          </div>
          <p>POSTER<span>RACT</span></p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="welcome-auth-heading"
            key={`${mode}-${view}`}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <p className="site-kicker">{heading.kicker}</p>
            <h2>{heading.title}</h2>
            <p>{heading.copy}</p>
          </motion.div>
        </AnimatePresence>

        {view === "auth" && (
          <div className="welcome-auth-modes" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={mode === "signin" ? "is-active" : undefined}
              onClick={() => setAuthMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "is-active" : undefined}
              onClick={() => setAuthMode("signup")}
            >
              Create account
            </button>
          </div>
        )}

        {view === "auth" && googleEnabled && (
          <>
            <button
              className="welcome-auth-google"
              type="button"
              disabled={busy !== null}
              onClick={signInWithGoogle}
            >
              <span className="welcome-google-mark" aria-hidden="true">
                <img src="/google-g.svg" alt="" width="18" height="18" />
              </span>
              <span>
                {busy === "google"
                  ? "Connecting to Google…"
                  : mode === "signin"
                    ? "Sign in with Google"
                    : "Sign up with Google"}
              </span>
            </button>
            <div className="welcome-auth-divider"><span>or continue with email</span></div>
          </>
        )}

        {view === "auth" && (
          <form className="welcome-auth-form" onSubmit={submitEmail}>
            {mode === "signup" && (
              <label>
                <span>Name</span>
                <div className="welcome-auth-input">
                  <UserRound aria-hidden="true" size={17} strokeWidth={1.7} />
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="What should we call you?"
                  />
                </div>
              </label>
            )}

            <label>
              <span>Email</span>
              <div className="welcome-auth-input">
                <Mail aria-hidden="true" size={17} strokeWidth={1.7} />
                <input
                  ref={emailRef}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </label>

            {(mode === "signup" || !magicLinkEnabled) && (
              <label>
                <span>Password</span>
                <div className="welcome-auth-input">
                  <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.7} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
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
            )}

            {mode === "signin" && emailVerificationEnabled && !magicLinkEnabled && (
              <button
                className="welcome-auth-text-action"
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setView("forgot");
                }}
              >
                Forgot password?
              </button>
            )}

            {error && <p className="welcome-auth-error" role="alert">{error}</p>}

            <button className="welcome-auth-submit" type="submit" disabled={busy !== null}>
              <span>
                {busy === "email"
                  ? "Contacting network…"
                  : mode === "signin" && magicLinkEnabled
                    ? "Send sign-in link"
                    : mode === "signin"
                      ? "Enter Posterract"
                      : "Create workspace"}
              </span>
              <MoveRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </form>
        )}

        {view === "forgot" && (
          <form className="welcome-auth-form" onSubmit={requestRecovery}>
            <label>
              <span>Account email</span>
              <div className="welcome-auth-input">
                <Mail aria-hidden="true" size={17} strokeWidth={1.7} />
                <input
                  ref={emailRef}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            </label>
            {error && <p className="welcome-auth-error" role="alert">{error}</p>}
            <button className="welcome-auth-submit" type="submit" disabled={busy !== null}>
              <span>{busy === "recovery" ? "Sending secure link…" : "Send reset link"}</span>
              <KeyRound aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
            <button className="welcome-auth-back" type="button" onClick={() => setView("auth")}>
              <MoveLeft aria-hidden="true" size={15} /> Back to sign in
            </button>
          </form>
        )}

        {(view === "verify" || view === "recovery-sent" || view === "signin-sent") && (
          <div className="welcome-auth-confirmation">
            <span className="welcome-auth-confirmation-icon" aria-hidden="true">
              <CircleCheck size={26} strokeWidth={1.55} />
            </span>
            <p>{email || "Your account email"}</p>
            <span>
              {view === "verify"
                ? "The link expires in one hour. Check spam if it does not appear within a minute."
                : view === "signin-sent"
                  ? "The single-use link expires in 15 minutes. For privacy, this confirmation is identical whether or not the address is registered."
                  : "For privacy, this confirmation looks the same whether or not the address is registered."}
            </span>
            {notice && <p className="welcome-auth-notice" role="status">{notice}</p>}
            {error && <p className="welcome-auth-error" role="alert">{error}</p>}
            {view === "verify" && (
              <button
                className="welcome-auth-secondary"
                type="button"
                disabled={busy !== null}
                onClick={resendVerification}
              >
                {busy === "resend" ? "Sending…" : "Resend verification email"}
              </button>
            )}
            <button
              className="welcome-auth-back"
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setMode("signin");
                setView("auth");
              }}
            >
              <MoveLeft aria-hidden="true" size={15} /> Back to sign in
            </button>
          </div>
        )}

        <p className="welcome-auth-legal">
          By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </motion.div>
  );
}
