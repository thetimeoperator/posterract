import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { HeroStage } from "@/marketing/hero/HeroStage";
import { PricingSection } from "@/components/ui/animated-pricing-card";
import { billingSelectionUrl, readBillingSelection, type BillingSelection } from "@/billing/selection";
import { WelcomeAuthCard, type WelcomeAuthMode } from "@/components/ui/welcome-auth-card";
import { LandingIntroWorld } from "@/marketing/LandingIntroWorld";
import { RandomLetterSwap } from "@/components/ui/random-letter-swap";
import { useHoverIntent } from "@/components/ui/use-hover-intent";
import { ShinyButton } from "@/components/ui/shiny-button";
import { LeverSwitch } from "@/components/ui/lever-switch";
import { AgencyFinalCta, AgencyHero, Apply, Engagement, Faq, HowItRuns, Team, workWithMe, type Shape } from "@/marketing/agency";
import { OpsWindow } from "@/marketing/agency/OpsWindow";
import "@/styles/homepage.css";
import "@/styles/homepage-readability.css";
import "@/styles/landing-two-mode.css";

/**
 * The landing page with two jobs and one switch.
 *
 * "Use the product" is the page as it is today. "Work with me" is the agency
 * offer. The switch in the nav decides which job the page is doing; the
 * world, the parallax and the nav stay put while the content changes.
 */

export type LandingMode = "product" | "work";

const MODE_PARAM = "mode";

function readMode(): LandingMode {
  if (typeof window === "undefined") return "product";
  return new URLSearchParams(window.location.search).get(MODE_PARAM) === "work" ? "work" : "product";
}

function writeMode(mode: LandingMode) {
  const url = new URL(window.location.href);
  if (mode === "work") url.searchParams.set(MODE_PARAM, "work");
  else url.searchParams.delete(MODE_PARAM);
  url.hash = "";
  window.history.replaceState(window.history.state, "", url);
}

const SWITCH: Array<{ mode: LandingMode; label: string }> = [
  { mode: "product", label: "Use the product" },
  { mode: "work", label: "Work with me" },
];

const SECTIONS: Record<LandingMode, Array<{ n: string; label: string; href: string }>> = {
  product: [
    { n: "01", label: "Network", href: "#platforms" },
    { n: "02", label: "Pricing", href: "#pricing" },
  ],
  work: [
    { n: "01", label: "The team", href: "#team" },
    { n: "02", label: "How it runs", href: "#how" },
    { n: "03", label: "Ways to work", href: "#engage" },
    { n: "04", label: "Apply", href: "#apply" },
  ],
};

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
        <div><p className="site-kicker">THE NETWORK // 08 DESTINATIONS</p><h2 id="platform-title">and your agent's scheduler.</h2></div>
        <p>Live connections today, with the same system expanding across the rest of the network.</p>
      </div>
      <div className="site-hero-platforms site-network-marks" aria-label="Where Posterract publishes">
        {PLATFORMS.map((platform) => (
          <span data-platform={platform.id} title={platform.name} key={platform.id}>
            <img src={platform.mark} alt={`${platform.name} logo`} />
          </span>
        ))}
      </div>
      <div className="site-network-ops">
        <OpsWindow />
      </div>
    </section>
  );
}

const ENTER = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const };
const SWAP = { staggerDuration: 0.022, transition: { type: "spring", duration: 0.55, bounce: 0.18 } as const };

/** A nav link whose letters swap on hover; the whole link is the hover surface. */
function NavLink({ href, label }: { href: string; label: string }) {
  const { hovered, handlers } = useHoverIntent();
  return (
    <a href={href} {...handlers}>
      <RandomLetterSwap label={label} hovered={hovered} {...SWAP} />
    </a>
  );
}

function NavButton({ className, label, onClick }: { className: string; label: string; onClick: () => void }) {
  const { hovered, handlers } = useHoverIntent();
  return (
    <button className={className} type="button" onClick={onClick} {...handlers}>
      <RandomLetterSwap label={label} hovered={hovered} {...SWAP} />
    </button>
  );
}

export function Landing() {
  const reduceMotion = useReducedMotion();
  const authDialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReturnUrl, setAuthReturnUrl] = useState(() => billingSelectionUrl(readBillingSelection()));
  const [authMode, setAuthMode] = useState<WelcomeAuthMode>("signin");
  const [mode, setMode] = useState<LandingMode>(readMode);
  const [shape, setShape] = useState<Shape>("managed");

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

  const openAuth = (nextMode: WelcomeAuthMode, selection?: BillingSelection) => {
    const returnUrl = billingSelectionUrl(selection ?? readBillingSelection());
    setAuthReturnUrl(returnUrl);
    window.history.replaceState(window.history.state, "", returnUrl);
    setAuthMode(nextMode);
    setAuthOpen(true);
  };

  const switchMode = (next: LandingMode) => {
    if (next === mode) return;
    setMode(next);
    writeMode(next);
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const chooseShape = (next: Shape) => {
    setShape(next);
    document.getElementById("apply")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const entrance = reduceMotion ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: ENTER };

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const read = () => setScrolled(window.scrollY > 24);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  /** The mode switch: a lever between the page's two jobs; the sign it points at lights up. */
  const forkNode = (
    <LeverSwitch
      options={[
        { value: "product", label: SWITCH[0]!.label },
        { value: "work", label: SWITCH[1]!.label },
      ]}
      value={mode}
      onChange={switchMode}
      label="What this page is for"
    />
  );

  return (
    <main className="site" id="top">
      <a className="site-skip" href={mode === "work" ? "#apply" : "#pricing"}>{mode === "work" ? "Skip to the application" : "Skip to pricing"}</a>
      <div className="site-stars" aria-hidden />
      <div className="site-grid" aria-hidden />

      <LandingIntroWorld>
        <header className="site-nav site-nav-landing site-nav-slim" data-scrolled={scrolled}>
          <div className="site-nav-brand">
            <a className="site-wordmark" href="#top" aria-label="Posterract home">POSTER<span>RACT</span></a>
          </div>
          <nav aria-label="Primary navigation">
            {SECTIONS[mode].map((section) => (
              <NavLink href={section.href} label={section.label} key={section.href} />
            ))}
          </nav>
          <div className="site-nav-actions">
            <NavButton className="site-nav-ghost" label="Sign in" onClick={() => openAuth("signin")} />
            {mode === "work" ? (
              <ShinyButton size="sm" label="Work with me" onClick={workWithMe} />
            ) : (
              <ShinyButton size="sm" label="Launch Posterract" onClick={() => openAuth("signup")} />
            )}
          </div>
        </header>

        {mode === "work" ? (
          <section className="site-hero site-hero-landing" aria-labelledby="site-title">
            <div className="site-hero-shade" aria-hidden="true" />
            <div className="site-hero-lever">{forkNode}</div>
            <motion.div className="site-hero-main site-hero-main-work" key="hero-work" {...entrance}>
              <AgencyHero />
            </motion.div>
          </section>
        ) : (
          <HeroStage fork={forkNode} onLaunch={() => openAuth("signup")} />
        )}

        <motion.div key={`world-${mode}`} {...entrance}>
          {mode === "work" ? (
            <>
              <Team />
              <HowItRuns />
            </>
          ) : (
            <PlatformNetwork />
          )}
        </motion.div>
      </LandingIntroWorld>

      <motion.div key={`ground-${mode}`} {...entrance}>
        {mode === "work" ? (
          <>
            <Engagement onChoose={chooseShape} />
            <Apply shape={shape} onShape={setShape} />
            <Faq />
            <AgencyFinalCta onProduct={() => switchMode("product")} />
          </>
        ) : (
          <>
            <PricingSection onLaunch={(selection) => openAuth("signup", selection)} />

          </>
        )}
      </motion.div>

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
              initialMode={authMode}
              successUrl={authReturnUrl}
              showClose
              onClose={() => setAuthOpen(false)}
              onSuccess={() => {
                setAuthOpen(false);
                window.location.assign(authReturnUrl);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
