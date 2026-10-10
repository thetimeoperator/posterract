import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { billingSelectionUrl, readBillingSelection, type BillingSelection } from "@/billing/selection";
import type { WelcomeAuthMode } from "@/components/ui/welcome-auth-card";
import { EnterTheGame } from "./EnterTheGame";
import { GameDayHero } from "./GameDayHero";
import { Lever } from "./Lever";
import { ProductTour } from "./ProductTour";
import type { PlanPrices } from "./prices";
import type { SavagesPlans } from "@/lib/savages";
import "@/styles/game.css";

/**
 * The landing as the game for content. The lever keeps both of the page's
 * jobs: green sells the game, cyan is Work with me. No video, no WebGL, no
 * animation library: the only motion is the lever's throw.
 */

export type LandingMode = "product" | "work";

const MODE_PARAM = "mode";

/** Work with me and the current page's stylesheets it needs: fetched when a hand reaches for the lever, or when the page opens on it. */
const loadWorkMode = () => import("./WorkMode");
const WorkMode = lazy(loadWorkMode);
const WelcomeAuthCard = lazy(() => import("@/components/ui/welcome-auth-card").then((module) => ({ default: module.WelcomeAuthCard })));

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

/**
 * The nav's two buttons load their own pages outright: while signed out, the
 * app shell sends any client-side move away from "/" straight back to "/".
 */
const goAuth = (mode: WelcomeAuthMode) => window.location.assign(`/gate?mode=${mode}`);

export function GameLanding({ prices, savagesPlans }: { prices?: PlanPrices; savagesPlans?: SavagesPlans }) {
  const [mode, setMode] = useState<LandingMode>(readMode);
  /** The mode before the last switch: the new page's lever starts there and throws across. */
  const previousMode = useRef<LandingMode | null>(null);
  // A switch is a transition: if the other side is still loading, this page stays up until it's ready, then the lever throws once.
  const [, startSwitch] = useTransition();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<WelcomeAuthMode>("signup");
  const [authReturnUrl, setAuthReturnUrl] = useState(() => billingSelectionUrl(readBillingSelection()));
  const authDialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const switchMode = (next: LandingMode) => {
    if (next === mode) return;
    previousMode.current = mode;
    startSwitch(() => setMode(next));
    writeMode(next);
  };

  // Throwing the lever lands on the new page's very top, once that page is in the DOM.
  useLayoutEffect(() => {
    if (previousMode.current === null) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [mode]);

  const openAuth = (nextMode: WelcomeAuthMode, selection?: BillingSelection) => {
    const returnUrl = billingSelectionUrl(selection ?? readBillingSelection());
    setAuthReturnUrl(returnUrl);
    // The plan rides in the address too: email verification and Google can
    // come back in a new document with no React state, and still check out
    // the plan that was picked.
    window.history.replaceState(window.history.state, "", returnUrl);
    setAuthMode(nextMode);
    setAuthOpen(true);
  };

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
        authDialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
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

  const lever = (
    <Lever
      options={[
        { value: "product", label: "Use the product" },
        { value: "work", label: "Work with me" },
      ]}
      value={mode}
      from={previousMode.current ?? undefined}
      onChange={switchMode}
      onIntent={() => void loadWorkMode()}
      label="What this page is for"
    />
  );

  return (
    <main className="game" id="top" data-palette={mode === "work" ? "cyan" : undefined}>
      {/* The sky behind the game: it stays put while every section scrolls over it. */}
      {mode === "product" && (
        <picture className="g-backdrop" aria-hidden="true">
          <source srcSet="/brand/game/backdrop.avif" type="image/avif" />
          <img src="/brand/game/backdrop.webp" alt="" decoding="async" />
        </picture>
      )}
      <a className="g-skip" href={mode === "work" ? "#apply" : "#enter"}>
        {mode === "work" ? "Skip to the application" : "Skip to the plan"}
      </a>

      <header className="g-nav">
        <a className="g-wordmark" href="#top" aria-label="Posterract home">
          POSTER<span>RACT</span>
        </a>
        <div className="g-nav-actions">
          <button className="g-btn g-btn-ghost" type="button" onClick={() => goAuth("signin")}>
            Sign in
          </button>
          <button className="g-btn g-btn-plate" type="button" onClick={() => goAuth("signup")}>
            Sign up
          </button>
        </div>
      </header>

      {/* One boundary around both sides, already on screen, so a switch to a side still loading keeps this one up instead of blanking. */}
      <Suspense fallback={<div className="g-work" />}>
        {mode === "work" ? (
          <WorkMode lever={lever} onProduct={() => switchMode("product")} />
        ) : (
          <>
            <GameDayHero lever={lever} onStart={() => openAuth("signup")} />
            <ProductTour />
            <EnterTheGame prices={prices} savagesPlans={savagesPlans} onStart={(selection) => openAuth("signup", selection)} />
          </>
        )}
      </Suspense>

      <footer className="g-footer">
        <div className="g-wrap g-footer-main">
          <a className="g-wordmark" href="#top">
            POSTER<span>RACT</span>
          </a>
          <p>One artifact. Multiple projections. Time is the fourth dimension.</p>
          <nav aria-label="Legal navigation">
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
              Google Privacy Policy
            </a>
            <a href="mailto:pahlevansina@gmail.com">Support</a>
          </nav>
        </div>
      </footer>

      {authOpen && (
        <div className="g-auth" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <div
            className="g-auth-welcome"
            ref={authDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Welcome to Posterract"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={null}>
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
            </Suspense>
          </div>
        </div>
      )}
    </main>
  );
}
