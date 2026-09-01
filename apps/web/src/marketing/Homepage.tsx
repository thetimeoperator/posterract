import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { Hero } from "@/components/ui/animated-hero";
import { PricingTierDeck } from "@/components/ui/pricing-tier-deck";
import {
  WelcomeAuthCard,
  type WelcomeAuthMode,
} from "@/components/ui/welcome-auth-card";
import { LandingIntroWorld } from "@/marketing/LandingIntroWorld";
import { RoadmapTerminal } from "@/marketing/RoadmapTerminal";
import "@/styles/homepage.css";
import "@/styles/homepage-readability.css";

type PlatformPhase = "live" | "limited" | "next";

type Platform = {
  id: string;
  name: string;
  mark: string;
  phase: PlatformPhase;
  capability: string;
};

const PLATFORMS: Platform[] = [
  { id: "youtube", name: "YouTube", mark: PLATFORM_MARK_SOURCES.youtube, phase: "next", capability: "Integration roadmap" },
  { id: "tiktok", name: "TikTok", mark: PLATFORM_MARK_SOURCES.tiktok, phase: "limited", capability: "Draft delivery / direct pending" },
  { id: "instagram", name: "Instagram", mark: PLATFORM_MARK_SOURCES.instagram, phase: "live", capability: "Publishing + insights" },
  { id: "facebook", name: "Facebook", mark: PLATFORM_MARK_SOURCES.facebook, phase: "live", capability: "Publishing + insights" },
  { id: "threads", name: "Threads", mark: PLATFORM_MARK_SOURCES.threads, phase: "live", capability: "Publishing + insights" },
  { id: "x", name: "X", mark: PLATFORM_MARK_SOURCES.x, phase: "next", capability: "Integration roadmap" },
  { id: "linkedin", name: "LinkedIn", mark: PLATFORM_MARK_SOURCES.linkedin, phase: "next", capability: "Integration roadmap" },
  { id: "reddit", name: "Reddit", mark: PLATFORM_MARK_SOURCES.reddit, phase: "next", capability: "Integration roadmap" },
];

function PlatformNetwork() {
  return (
    <section className="site-platforms" id="platforms" aria-labelledby="platform-title">
      <div className="site-platforms-heading">
        <div><p className="site-kicker">THE NETWORK // 08 DESTINATIONS</p><h2 id="platform-title">Where Posterract publishes.</h2></div>
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
            <strong>{platform.phase === "live" ? "LIVE" : platform.phase === "limited" ? "DRAFT LIVE" : "COMING SOON"}</strong>
          </article>
        ))}
      </div>
      <div className="site-platform-note">
        <p><strong>LIVE NOW</strong> Instagram / Facebook / Threads</p>
        <p><strong>LIMITED</strong> TikTok draft delivery</p>
        <p><strong>ROADMAP</strong> YouTube / X / LinkedIn / Reddit</p>
      </div>
    </section>
  );
}

export function Homepage() {
  const navigate = useNavigate();
  const authDialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState<WelcomeAuthMode>("signin");

  useEffect(() => {
    if (!authOpen) return;
    const previousOverflow = document.body.style.overflow;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAuthOpen(false);
        return;
      }
      if (event.key !== "Tab" || !authDialogRef.current) return;
      const focusable = Array.from(
        authDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [authOpen]);

  const openAuth = (nextMode: WelcomeAuthMode) => {
    setMode(nextMode);
    setAuthOpen(true);
  };

  return (
    <main className="site" id="top">
      <a className="site-skip" href="#pricing">Skip to pricing</a>
      <div className="site-stars" aria-hidden />
      <div className="site-grid" aria-hidden />

      <LandingIntroWorld>
        <section className="site-hero" aria-labelledby="site-title">
          <div className="site-hero-shade" aria-hidden="true" />

          <header className="site-nav">
            <div className="site-nav-brand">
              <a className="site-wordmark" href="#top" aria-label="Posterract home">POSTER<span>RACT</span></a>
              <span className="site-nav-system">PUBLISHING OS // 01</span>
            </div>
            <nav aria-label="Primary navigation">
              <a href="#platforms"><span>01</span> Network</a>
              <a href="#roadmap"><span>02</span> Roadmap</a>
              <a href="#pricing"><span>03</span> Pricing</a>
              <a href="#analytics"><span>04</span> Analytics</a>
            </nav>
            <div className="site-nav-actions">
              <button className="site-nav-signin" type="button" onClick={() => openAuth("signin")}>Sign in</button>
              <button className="site-nav-cta" type="button" onClick={() => openAuth("signup")}>Launch Posterract</button>
            </div>
          </header>

          <div className="site-hero-main">
            <Hero onLaunch={() => openAuth("signup")} />
          </div>

        </section>

        <PlatformNetwork />
        <RoadmapTerminal />
      </LandingIntroWorld>

      <section className="site-pricing" id="pricing" aria-labelledby="pricing-title">
        <div className="site-pricing-copy">
          <p className="site-kicker">THREE TIERS // AI CREDITS INCLUDED</p>
          <h2 id="pricing-title">Every tier is the full command center. Credits set the fuel.</h2>
          <p>Publishing, scheduling, and analytics come with every plan. AI credits refill monthly and power image, video, and voice generation—when they hit zero, generation simply stops. No overages, no surprise charges.</p>

          <div className="site-pricing-sequence" aria-label="Posterract plan capabilities">
            <div><span>01</span><strong>Connect</strong><small>Social accounts + agent API</small></div>
            <i />
            <div><span>02</span><strong>Command</strong><small>Schedule from one calendar</small></div>
            <i />
            <div><span>03</span><strong>Measure</strong><small>Authorized performance signals</small></div>
          </div>
        </div>

        <PricingTierDeck onLaunch={() => openAuth("signup")} />

        <div className="site-pricing-honesty" aria-label="How Posterract billing works">
          <p><strong>CREDITS INCLUDED</strong> Every tier refills its full allotment each month.</p>
          <p><strong>HARD STOP AT ZERO</strong> Generation pauses instead of billing overages.</p>
          <p><strong>LOCAL EXPORTS</strong> Your exports stay on your computer—the cloud is only for scheduling.</p>
        </div>
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
          <h2 id="pipeline-title">A real publishing sequence—not eight separate chores.</h2>
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
          <p>NETWORK MIRROR // 08</p>
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
          <div
            className="site-auth-welcome"
            ref={authDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to Posterract"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <WelcomeAuthCard
              initialMode={mode}
              showClose
              onClose={() => setAuthOpen(false)}
              onSuccess={() => {
                setAuthOpen(false);
                void navigate({ to: "/" });
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
