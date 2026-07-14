import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/authClient";
import "@/styles/homepage.css";

type AuthMode = "signin" | "signup";

const CHANNELS = ["YouTube", "TikTok", "Instagram", "Facebook", "Threads", "X", "LinkedIn"];

export function Homepage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const authTitleId = useId();
  const [videoReady, setVideoReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePlayback = () => {
      if (reducedMotion.matches) {
        video.pause();
      } else if (document.visibilityState === "visible") {
        void video.play().catch(() => undefined);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || reducedMotion.matches) video.pause();
        else void video.play().catch(() => undefined);
      },
      { threshold: 0.08 },
    );

    observer.observe(video);
    reducedMotion.addEventListener("change", updatePlayback);
    document.addEventListener("visibilitychange", updatePlayback);
    updatePlayback();

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", updatePlayback);
      document.removeEventListener("visibilitychange", updatePlayback);
    };
  }, []);

  useEffect(() => {
    if (!authOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => emailRef.current?.focus(), 80);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAuthOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [authOpen]);

  const openAuth = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setAuthOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
          : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "That transmission was not accepted. Check your details.");
      } else {
        setAuthOpen(false);
        void navigate({ to: "/" });
      }
    } catch {
      setError("The authentication relay is unreachable. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home" id="top">
      <a className="home-skip" href="#mission">
        Skip to product overview
      </a>
      <div className="home-stars" aria-hidden />
      <div className="home-grid" aria-hidden />

      <section className="home-intro" aria-labelledby="home-title">
        <header className="home-nav">
          <a className="home-wordmark" href="#top" aria-label="Posterract home">
            POSTER<span>RACT</span>
          </a>
          <nav className="home-nav-links" aria-label="Primary navigation">
            <a href="#mission">Mission</a>
            <a href="/privacy">Privacy policy</a>
            <a href="/terms">Terms</a>
            <button type="button" onClick={() => openAuth("signin")}>
              Sign in
            </button>
          </nav>
          <button className="home-nav-cta" type="button" onClick={() => openAuth("signup")}>
            Create account
          </button>
        </header>

        <div className="home-hero">
          <div className="home-hero-copy">
            <p className="home-eyebrow">TRANSMISSION CONTROL // PUBLIC ACCESS</p>
            <h1 id="home-title">
              Publish once.
              <span>Arrive everywhere.</span>
            </h1>
            <p className="home-lede">
              Posterract is the command center for short-form publishing. Upload one video, schedule its release,
              send it to your connected social channels, and read authorized performance signals in one place.
            </p>
            <div className="home-actions">
              <button className="home-primary" type="button" onClick={() => openAuth("signup")}>
                Begin transmission
              </button>
              <button className="home-secondary" type="button" onClick={() => openAuth("signin")}>
                Open your command center
              </button>
            </div>
            <p className="home-signal-note">
              <span aria-hidden /> Built for creators who refuse to publish the same work seven times.
            </p>
          </div>

          <div className="home-relic" aria-label="The Posterract publishing relic">
            <div className="home-relic-orbit home-relic-orbit-a" aria-hidden />
            <div className="home-relic-orbit home-relic-orbit-b" aria-hidden />
            <div className="home-relic-frame" aria-hidden />
            <video
              ref={videoRef}
              className={videoReady ? "home-relic-video is-ready" : "home-relic-video"}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/media/posterract-relic-poster.webp"
              onCanPlay={() => setVideoReady(true)}
              aria-hidden
            >
              <source src="/media/posterract-relic-loop.webm" type="video/webm" />
              <source src="/media/posterract-relic-loop.mp4" type="video/mp4" />
            </video>
            <div className="home-relic-index home-relic-index-left" aria-hidden>
              <span>ARTIFACT</span>
              <strong>PR//01</strong>
            </div>
            <div className="home-relic-index home-relic-index-right" aria-hidden>
              <span>SIGNAL</span>
              <strong>STABLE</strong>
            </div>
            <div className="home-channel-rail" aria-label="Publishing destinations and roadmap">
              {CHANNELS.map((channel, index) => (
                <span key={channel} className={index < 3 ? "is-live" : undefined}>
                  {String(index + 1).padStart(2, "0")} {channel}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="home-compliance" aria-label="YouTube integration and legal links">
          <div className="home-youtube">
            <a
              className="home-youtube-mark"
              href="https://www.youtube.com/"
              target="_blank"
              rel="noreferrer"
              aria-label="Visit YouTube"
            >
              <img src="/brand/youtube-logo.svg" alt="YouTube" />
            </a>
            <p>
              Uploads and authorized channel analytics are provided through <strong>YouTube API Services.</strong>
            </p>
          </div>
          <div className="home-legal-links">
            <span>DATA &amp; ACCESS</span>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
              Google Privacy Policy
            </a>
          </div>
        </div>
      </section>

      <section className="home-section home-mission" id="mission" aria-labelledby="mission-title">
        <div className="home-section-heading">
          <p className="home-eyebrow">THE MISSION // COLLAPSE THE DISTANCE</p>
          <h2 id="mission-title">Your work is one artifact. Every platform is a projection.</h2>
          <p>
            Posterract keeps the video, caption, timing, channel connections, publishing status, and performance
            signals inside one deliberate workflow.
          </p>
        </div>

        <ol className="home-sequence">
          <li>
            <span>01</span>
            <div>
              <h3>Prepare the artifact</h3>
              <p>Upload the source once, write the message, and select the channels that should receive it.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Choose the moment</h3>
              <p>Schedule one coordinated release or tune timing for each destination.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Read the signal</h3>
              <p>Track publishing outcomes and authorized audience metrics without leaving the command center.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="home-section home-system" aria-labelledby="system-title">
        <div className="home-system-figure" aria-hidden>
          <span>ONE</span>
          <div />
          <strong>07</strong>
          <p>ONE SOURCE // MULTIPLE ORBITS</p>
        </div>
        <div className="home-system-copy">
          <p className="home-eyebrow">THE SYSTEM // BUILT FOR THE REAL WORK</p>
          <h2 id="system-title">A publishing instrument, not another content maze.</h2>
          <dl>
            <div>
              <dt>Compose</dt>
              <dd>Keep the source video and cross-platform message together.</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>Turn release time into a single controllable dimension.</dd>
            </div>
            <div>
              <dt>Publish</dt>
              <dd>Transmit only to accounts you explicitly connect and authorize.</dd>
            </div>
            <div>
              <dt>Analyze</dt>
              <dd>Filter authorized metrics by network, account, post, and date.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="home-section home-control" aria-labelledby="control-title">
        <p className="home-eyebrow">USER CONTROL // THE SIGNAL REMAINS YOURS</p>
        <h2 id="control-title">Connect deliberately. Disconnect completely.</h2>
        <p>
          You choose which platforms Posterract can access. Disconnecting a social account removes its connection
          and the analytics Posterract retrieved for that account, as described in our Privacy Policy.
        </p>
        <div className="home-control-actions">
          <a href="/privacy">Read the Privacy Policy</a>
          <a href="/terms">Read the Terms of Service</a>
        </div>
      </section>

      <section className="home-final" aria-labelledby="final-title">
        <div>
          <p className="home-eyebrow">TRANSMISSION WINDOW // OPEN</p>
          <h2 id="final-title">Stop repeating the work.</h2>
        </div>
        <button type="button" onClick={() => openAuth("signup")}>
          Create your command center
        </button>
      </section>

      <footer className="home-footer">
        <a className="home-wordmark" href="#top">
          POSTER<span>RACT</span>
        </a>
        <p>One artifact. Multiple projections. Time is the fourth dimension.</p>
        <nav aria-label="Footer navigation">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="mailto:pahlevansina@gmail.com">Support</a>
        </nav>
      </footer>

      {authOpen && (
        <div className="home-auth" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <div
            className="home-auth-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={authTitleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="home-auth-topline">
              <span>SECURE ACCESS // POSTERRACT</span>
              <button type="button" onClick={() => setAuthOpen(false)}>
                CLOSE // ESC
              </button>
            </div>
            <div className="home-auth-heading">
              <p className="home-eyebrow">AUTHENTICATION RELAY</p>
              <h2 id={authTitleId}>{mode === "signin" ? "Open the command center." : "Claim your command center."}</h2>
              <p>
                {mode === "signin"
                  ? "Return to your publishing system."
                  : "Create the account that will hold your connected channels and publishing history."}
              </p>
            </div>

            <div className="home-auth-modes" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={mode === "signin" ? "is-active" : undefined}
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "is-active" : undefined}
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Create account
              </button>
            </div>

            <form className="home-auth-form" onSubmit={submit}>
              {mode === "signup" && (
                <label>
                  <span>Name</span>
                  <input
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                  />
                </label>
              )}
              <label>
                <span>Email</span>
                <input
                  ref={emailRef}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                />
              </label>
              {error && <p className="home-auth-error" role="alert">{error}</p>}
              <button className="home-auth-submit" type="submit" disabled={busy}>
                {busy ? "Contacting relay..." : mode === "signin" ? "Enter Posterract" : "Create account"}
              </button>
            </form>

            <p className="home-auth-legal">
              By creating an account, you agree to our <a href="/terms">Terms of Service</a> and acknowledge our{" "}
              <a href="/privacy">Privacy Policy</a>.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
