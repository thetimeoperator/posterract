import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { YOUTUBE_ICON_DATA_URI } from "@posterract/hyperkit";
import { authClient } from "@/lib/authClient";
import "@/styles/homepage.css";

type AuthMode = "signin" | "signup";
type PlatformPhase = "live" | "next";

type Platform = {
  id: string;
  name: string;
  mark: string;
  phase: PlatformPhase;
  capability: string;
};

const PLATFORMS: Platform[] = [
  { id: "youtube", name: "YouTube", mark: YOUTUBE_ICON_DATA_URI, phase: "live", capability: "Publishing + analytics" },
  { id: "tiktok", name: "TikTok", mark: "/brand/platforms/tiktok.svg", phase: "live", capability: "Publishing + analytics" },
  { id: "instagram", name: "Instagram", mark: "/brand/platforms/instagram.svg", phase: "live", capability: "Publishing + insights" },
  { id: "facebook", name: "Facebook", mark: "/brand/platforms/facebook.svg", phase: "next", capability: "Integration roadmap" },
  { id: "threads", name: "Threads", mark: "/brand/platforms/threads.svg", phase: "next", capability: "Integration roadmap" },
  { id: "x", name: "X", mark: "/brand/platforms/x.svg", phase: "next", capability: "Integration roadmap" },
  { id: "linkedin", name: "LinkedIn", mark: "/brand/platforms/linkedin.png", phase: "next", capability: "Integration roadmap" },
];

function PlatformNetwork() {
  return (
    <section className="site-platforms" id="platforms" aria-labelledby="platform-title">
      <div className="site-platforms-heading">
        <div><p className="site-kicker">THE NETWORK // 07 DESTINATIONS</p><h2 id="platform-title">Where Posterract publishes.</h2></div>
        <p>Live connections today, with the same system expanding across the rest of the network.</p>
      </div>
      <div className="site-platform-grid">
        {PLATFORMS.map((platform, index) => (
          <article className={`site-platform site-platform-${platform.phase}`} data-platform={platform.id} key={platform.id}>
            <span className="site-platform-index">{String(index + 1).padStart(2, "0")}</span>
            {platform.id === "youtube" ? (
              <a
                className="site-platform-mark"
                href="https://www.youtube.com/"
                target="_blank"
                rel="noreferrer"
                aria-label="Open YouTube"
              >
                <img src={platform.mark} alt="YouTube" />
              </a>
            ) : (
              <div className="site-platform-mark"><img src={platform.mark} alt={`${platform.name} logo`} /></div>
            )}
            <div><h3>{platform.name}</h3><p>{platform.capability}</p></div>
            <strong>{platform.phase === "live" ? "LIVE" : "NEXT"}</strong>
          </article>
        ))}
      </div>
      <div className="site-platform-note">
        <p><strong>LIVE NOW</strong> YouTube / TikTok / Instagram</p>
        <p><strong>EXPANSION</strong> Facebook / Threads / X / LinkedIn</p>
      </div>
    </section>
  );
}

export function Homepage() {
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);
  const authTitleId = useId();
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <main className="site" id="top">
      <a className="site-skip" href="#workflow">Skip to product overview</a>
      <div className="site-stars" aria-hidden />
      <div className="site-grid" aria-hidden />

      <section className="site-hero" aria-labelledby="site-title">
        <header className="site-nav">
          <div className="site-nav-brand">
            <a className="site-wordmark" href="#top" aria-label="Posterract home">POSTER<span>RACT</span></a>
            <span className="site-nav-system">PUBLISHING OS // 01</span>
          </div>
          <nav aria-label="Primary navigation">
            <a href="#platforms"><span>01</span> Network</a>
            <a href="#workflow"><span>02</span> Workflow</a>
            <a href="#analytics"><span>03</span> Analytics</a>
          </nav>
          <div className="site-nav-actions">
            <button className="site-nav-signin" type="button" onClick={() => openAuth("signin")}>Sign in</button>
            <button className="site-nav-cta" type="button" onClick={() => openAuth("signup")}>Launch Posterract</button>
          </div>
        </header>

        <div className="site-hero-main">
          <div className="site-hero-copy">
            <p className="site-kicker">SOCIAL PUBLISHING // ONE COMMAND CENTER</p>
            <h1 id="site-title">One upload.<span>Every channel.</span></h1>
            <p className="site-hero-lede">
              Posterract turns one finished video into a coordinated publishing sequence—scheduled, distributed, and measured without the tab-hopping.
            </p>
            <div className="site-actions">
              <button className="site-primary" type="button" onClick={() => openAuth("signup")}>Start publishing</button>
              <a className="site-secondary" href="#workflow">See how it works</a>
            </div>
            <p className="site-live"><span /> Publishing live on YouTube, TikTok, and Instagram.</p>
          </div>

          <div className="site-console" aria-label="Posterract publishing interface preview">
            <div className="site-console-bar">
              <span>NEW TRANSMISSION</span>
              <strong>READY // 024</strong>
            </div>
            <div className="site-console-body">
              <div className="site-media-preview">
                <div className="site-media-orbit" aria-hidden />
                <div className="site-media-core"><span>VIDEO</span><strong>00:24</strong></div>
                <p>PRIMARY ARTIFACT // VERTICAL 9:16</p>
              </div>
              <dl className="site-console-meta">
                <div><dt>Caption</dt><dd>The final cut is ready.</dd></div>
                <div><dt>Launch</dt><dd>Today · 6:30 PM</dd></div>
                <div><dt>Visibility</dt><dd>Public</dd></div>
              </dl>
            </div>
            <div className="site-console-route">
              <span>UPLOAD</span><i /><span>SCHEDULE</span><i /><span>PUBLISH</span><i /><strong>MEASURE</strong>
            </div>
          </div>
        </div>

        <div className="site-hero-stats" aria-label="Posterract capabilities">
          <div><span>01</span><p>One source video</p></div>
          <div><span>04</span><p>One launch workflow</p></div>
          <div><span>07</span><p>Platform destinations</p></div>
          <div><span>24/7</span><p>Publishing status</p></div>
        </div>
      </section>

      <PlatformNetwork />

      <section className="site-workflow" id="workflow" aria-labelledby="workflow-title">
        <div className="site-section-heading">
          <p className="site-kicker">THE WORKFLOW</p>
          <h2 id="workflow-title">Your content stays singular.</h2>
          <p>Every decision lives around the same artifact—from the first upload to the final performance signal.</p>
        </div>
        <ol className="site-workflow-list">
          <li><span>01</span><div><h3>Compose once</h3><p>Upload the finished video, write the core message, and keep everything together.</p></div></li>
          <li><span>02</span><div><h3>Choose the orbit</h3><p>Select connected channels and tune platform-specific publishing details.</p></div></li>
          <li><span>03</span><div><h3>Control the moment</h3><p>Publish immediately or schedule the release across every destination.</p></div></li>
          <li><span>04</span><div><h3>Read the signal</h3><p>Track publishing outcomes and authorized audience performance in one view.</p></div></li>
        </ol>
      </section>

      <section className="site-pipeline" aria-labelledby="pipeline-title">
        <div className="site-pipeline-visual" aria-hidden>
          <div className="site-pipeline-header"><span>LAUNCH SEQUENCE</span><strong>ACTIVE</strong></div>
          <div className="site-pipeline-track">
            <div className="is-complete"><span>01</span><strong>Artifact received</strong><small>18:22:04</small></div>
            <i />
            <div className="is-complete"><span>02</span><strong>Destinations locked</strong><small>18:22:06</small></div>
            <i />
            <div className="is-active"><span>03</span><strong>Launch scheduled</strong><small>18:30:00</small></div>
            <i />
            <div><span>04</span><strong>Signals incoming</strong><small>WAITING</small></div>
          </div>
        </div>
        <div className="site-pipeline-copy">
          <p className="site-kicker">NO MORE REPETITION</p>
          <h2 id="pipeline-title">A real publishing sequence—not seven separate chores.</h2>
          <p>Prepare the work once. Posterract handles the timing, destination state, retries, and publishing record around it.</p>
        </div>
      </section>

      <section className="site-analytics" id="analytics" aria-labelledby="analytics-title">
        <div className="site-analytics-copy">
          <p className="site-kicker">AUTHORIZED ANALYTICS</p>
          <h2 id="analytics-title">Every signal in one room.</h2>
          <p>Filter performance by platform, account, post, and date. See views, followers, subscribers, engagement, and publishing health without rebuilding the picture manually.</p>
        </div>
        <div className="site-analytics-panel" aria-hidden>
          <div className="site-analytics-top"><span>PERFORMANCE // 30 DAYS</span><strong>+18.4%</strong></div>
          <div className="site-analytics-number"><span>TOTAL VIEWS</span><strong>284.6K</strong></div>
          <div className="site-bars">
            {[31, 48, 38, 64, 55, 72, 61, 84, 68, 91, 78, 96].map((height, index) => <i style={{ height: `${height}%` }} key={index} />)}
          </div>
          <div className="site-analytics-axis"><span>JUN 14</span><span>JUL 13</span></div>
        </div>
      </section>

      <section className="site-final-cta" aria-labelledby="final-title">
        <p className="site-kicker">YOUR NEXT POST STARTS ONCE</p>
        <h2 id="final-title">Publish the work.<br />Not the repetition.</h2>
        <button type="button" onClick={() => openAuth("signup")}>Create your command center</button>
      </section>

      <footer className="site-footer" id="footer">
        <div className="site-footer-platforms" aria-label="Posterract platform network">
          <p>NETWORK MIRROR // 07</p>
          <div>
            {PLATFORMS.map((platform) => (
              <span className="site-footer-platform" data-platform={platform.id} key={platform.id}>
                <small>{platform.name}</small>
              </span>
            ))}
          </div>
        </div>
        <div className="site-footer-main">
          <a className="site-wordmark" href="#top">POSTER<span>RACT</span></a>
          <p>One artifact. Multiple projections. Time is the fourth dimension.</p>
          <nav aria-label="Legal navigation">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google Privacy Policy</a>
            <a href="mailto:pahlevansina@gmail.com">Support</a>
          </nav>
        </div>
        <div className="site-footer-meta">
          <p>YouTube uploads and authorized channel analytics use YouTube API Services.</p>
          <p>Platform names and logos belong to their respective owners. Availability depends on platform API access and approval.</p>
        </div>
      </footer>

      {authOpen && (
        <div className="site-auth" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <div className="site-auth-panel" role="dialog" aria-modal="true" aria-labelledby={authTitleId} onMouseDown={(event) => event.stopPropagation()}>
            <div className="site-auth-topline"><span>SECURE ACCESS // POSTERRACT</span><button type="button" onClick={() => setAuthOpen(false)}>CLOSE // ESC</button></div>
            <div className="site-auth-heading"><p className="site-kicker">AUTHENTICATION RELAY</p><h2 id={authTitleId}>{mode === "signin" ? "Open the command center." : "Claim your command center."}</h2><p>{mode === "signin" ? "Return to your publishing system." : "Create the account that will hold your connected channels and publishing history."}</p></div>
            <div className="site-auth-modes" role="tablist" aria-label="Authentication mode">
              <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "is-active" : undefined} onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "is-active" : undefined} onClick={() => { setMode("signup"); setError(null); }}>Create account</button>
            </div>
            <form className="site-auth-form" onSubmit={submit}>
              {mode === "signup" && <label><span>Name</span><input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>}
              <label><span>Email</span><input ref={emailRef} type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label><span>Password</span><input type="password" required minLength={8} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "At least 8 characters" : "Your password"} /></label>
              {error && <p className="site-auth-error" role="alert">{error}</p>}
              <button className="site-auth-submit" type="submit" disabled={busy}>{busy ? "Contacting relay..." : mode === "signin" ? "Enter Posterract" : "Create account"}</button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
