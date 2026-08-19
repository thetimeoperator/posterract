import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, SkipForward } from "lucide-react";
import { MiniTesseract, Starfield } from "@posterract/hyperkit";
import { COMING_SOON_PLATFORM_IDS, PLATFORM_CAPABILITIES, PLATFORM_ORDER, type PlatformId } from "@posterract/contract";
import { ENGINE_MODE } from "@/engine/useEngine";
import { WarpingIn } from "@/shell/SystemStates";
import { EntranceRelicStage, type EntrancePhase } from "@/core3d/v2/EntranceRelicStage";
import type { RelicPodState } from "@/core3d/v2/PosterractRelic";
import { useAuthState } from "@/lib/useAuthState";

export const Route = createFileRoute("/enter")({
  component: ENGINE_MODE === "cloud" ? CloudEntrance : Entrance,
});

const ACTIVE_PHASES: EntrancePhase[] = ["igniting", "deploying", "aligning", "portal", "navigating"];
const isComingSoon = (platform: PlatformId) => (COMING_SOON_PLATFORM_IDS as readonly string[]).includes(platform);

const PHASE_COPY: Record<EntrancePhase, { eyebrow: string; line: string }> = {
  idle: { eyebrow: "Transmission chamber ready", line: "Touch the core" },
  hovering: { eyebrow: "Signal detected", line: "Open the Posterract" },
  igniting: { eyebrow: "Source acquired", line: "Ingesting one artifact" },
  deploying: { eyebrow: "Projection engine active", line: "Generating six destinations" },
  aligning: { eyebrow: "Time is the fourth dimension", line: "One moment · six channels" },
  portal: { eyebrow: "Gate aligned", line: "Your post is ready to exist everywhere" },
  navigating: { eyebrow: "Crossing the threshold", line: "Entering Posterract" },
};

function CloudEntrance() {
  const { isLoading, isAuthenticated } = useAuthState();
  if (isLoading) return <WarpingIn />;
  if (isAuthenticated) return <Navigate to="/" />;
  return <Entrance />;
}

function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function StaticEntranceRelic({ active }: { active: boolean }) {
  return (
    <div className="entrance-static-relic" aria-hidden>
      <div className="entrance-static-orbit entrance-static-orbit-a" />
      <div className="entrance-static-orbit entrance-static-orbit-b" />
      <div className="entrance-static-core">
        <MiniTesseract size={150} state={active ? "transmitting" : "idle"} />
      </div>
      {PLATFORM_ORDER.map((platform, index) => {
        const angle = (index / PLATFORM_ORDER.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <span
            key={platform}
            className="entrance-static-node is-word"
            style={{
              color: "var(--starlight-dim)",
              transform: `translate(-50%, -50%) translate(${Math.cos(angle) * 180}px, ${Math.sin(angle) * 180}px)`,
            }}
          >
            {PLATFORM_CAPABILITIES[platform].label}
          </span>
        );
      })}
    </div>
  );
}

function Entrance() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<EntrancePhase>("idle");
  const [hoveredPlatform, setHoveredPlatform] = useState<PlatformId | null>(null);
  const [stageReady, setStageReady] = useState(false);
  const [webGL] = useState(hasWebGL);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const started = useRef(false);
  const navigated = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const navigateToGate = useCallback(() => {
    if (navigated.current) return;
    navigated.current = true;
    clearTimers();
    setPhase("navigating");
    void navigate({ to: ENGINE_MODE === "demo" ? "/" : "/gate" });
  }, [clearTimers, navigate]);

  const schedule = useCallback((callback: () => void, delay: number) => {
    timers.current.push(setTimeout(callback, delay));
  }, []);

  const activate = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setHoveredPlatform(null);

    if (reducedMotion || !webGL) {
      setPhase("portal");
      schedule(navigateToGate, 220);
      return;
    }

    setPhase("igniting");
    schedule(() => setPhase("deploying"), 900);
    schedule(() => setPhase("aligning"), 2350);
    schedule(() => setPhase("portal"), 3350);
    schedule(navigateToGate, 4250);
  }, [navigateToGate, reducedMotion, schedule, webGL]);

  const skip = useCallback(() => {
    if (navigated.current) return;
    started.current = true;
    clearTimers();
    setHoveredPlatform(null);
    setPhase("portal");
    schedule(navigateToGate, reducedMotion ? 180 : 650);
  }, [clearTimers, navigateToGate, reducedMotion, schedule]);

  const running = ACTIVE_PHASES.includes(phase);
  const copy = PHASE_COPY[phase];
  const activeCaps = hoveredPlatform ? PLATFORM_CAPABILITIES[hoveredPlatform] : null;
  const setExplorationTarget = useCallback(
    (platform: PlatformId | null) => {
      if (running) return;
      setHoveredPlatform(platform);
      setPhase(platform ? "hovering" : "idle");
    },
    [running],
  );

  const podStates = useMemo(() => {
    return Object.fromEntries(
      PLATFORM_ORDER.map((platform) => {
        let state: RelicPodState = "offline";
        if (isComingSoon(platform)) return [platform, state];
        if (phase === "idle" || phase === "hovering") state = platform === hoveredPlatform ? "active" : "offline";
        if (phase === "igniting") state = "ready";
        if (phase === "deploying") state = "active";
        if (phase === "aligning" || phase === "portal" || phase === "navigating") state = "complete";
        return [platform, state];
      }),
    ) as Record<PlatformId, RelicPodState>;
  }, [hoveredPlatform, phase]);

  const platformStatus = (platform: PlatformId) => {
    if (isComingSoon(platform)) return "COMING SOON";
    if ((phase === "idle" || phase === "hovering") && platform === hoveredPlatform) return "SIGNAL FOUND";
    if (phase === "igniting") return "ACQUIRING";
    if (phase === "deploying") return "ADAPTING";
    if (phase === "aligning") return "ALIGNED";
    if (phase === "portal" || phase === "navigating") return "READY";
    return "DORMANT";
  };

  return (
    <main className="entrance-shell relative isolate h-[100dvh] min-h-[560px] overflow-hidden bg-void-0 text-starlight">
      <div className="entrance-grid chamber-grid absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden>
        <Starfield />
      </div>
      <div className="entrance-reactor-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="entrance-noise pointer-events-none absolute inset-0" aria-hidden />

      {webGL && !reducedMotion ? (
        <EntranceRelicStage
          phase={phase}
          podStates={podStates}
          hoveredPlatform={running ? null : hoveredPlatform}
          onPlatformHover={setExplorationTarget}
          onReady={() => setStageReady(true)}
          className="absolute inset-0 z-[2]"
        />
      ) : (
        <div className="absolute inset-0 z-[2] flex items-center justify-center">
          <StaticEntranceRelic active={running} />
        </div>
      )}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-5 pt-[max(20px,env(safe-area-inset-top))] sm:px-8 sm:pt-7">
        <div className="entrance-corner-mark">
          <p className="telemetry text-[9px] uppercase tracking-[0.2em] text-starlight-faint">Transmission chamber · 001</p>
          <p className="mt-1 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-neon">Public access</p>
        </div>
        <div className="pointer-events-auto">
          {running ? (
            <button type="button" onClick={skip} className="entrance-skip">
              <SkipForward size={13} />
              Skip animation
            </button>
          ) : (
            <Link to={ENGINE_MODE === "demo" ? "/" : "/gate"} className="entrance-skip">
              Sign in
              <ArrowRight size={13} />
            </Link>
          )}
        </div>
      </header>

      <div className="pointer-events-none absolute inset-x-0 top-[8%] z-10 text-center sm:top-[7%]">
        <motion.p
          animate={{ opacity: running ? 0.3 : 1, y: running ? -5 : 0 }}
          className="font-display text-[clamp(22px,3.2vw,46px)] font-bold tracking-[0.3em] text-starlight [text-shadow:0_0_34px_rgba(101,255,154,0.28)]"
        >
          POSTER<span className="text-neon">RACT</span>
        </motion.p>
        <motion.p
          animate={{ opacity: running ? 0 : 0.72 }}
          className="mt-2 telemetry text-[9px] uppercase tracking-[0.34em] text-starlight-dim sm:text-[10px]"
        >
          One artifact · six destinations
        </motion.p>
      </div>

      <button
        type="button"
        aria-label="Open Posterract and continue to sign in"
        disabled={running}
        onClick={activate}
        onPointerEnter={() => !running && setPhase("hovering")}
        onPointerLeave={() => !running && !hoveredPlatform && setPhase("idle")}
        onFocus={() => !running && setPhase("hovering")}
        onBlur={() => !running && !hoveredPlatform && setPhase("idle")}
        className="entrance-core-control absolute left-1/2 top-1/2 z-10 aspect-square w-[clamp(170px,28vmin,320px)] -translate-x-1/2 -translate-y-1/2 rounded-full disabled:cursor-default"
      >
        <span className="sr-only">Open Posterract</span>
        <span className="entrance-core-reticle" aria-hidden />
      </button>

      <div
        className={
          running
            ? "pointer-events-none absolute inset-x-0 top-[16%] z-20 flex justify-center px-5"
            : "pointer-events-none absolute inset-x-0 bottom-[18vh] z-20 flex justify-center px-5 sm:bottom-[76px]"
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${phase}-${hoveredPlatform ?? "core"}`}
            initial={{ opacity: 0, y: 8, filter: "blur(5px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(5px)" }}
            transition={{ duration: 0.24 }}
            className="text-center"
            aria-live="polite"
          >
            <p className="telemetry text-[9px] uppercase tracking-[0.2em] text-neon sm:text-[10px]">
              {activeCaps && !running ? `${activeCaps.label} · ${platformStatus(activeCaps.id)}` : copy.eyebrow}
            </p>
            <p className="mt-1.5 font-display text-[12px] font-semibold uppercase tracking-[0.18em] text-starlight sm:text-[14px]">
              {activeCaps && !running
                ? isComingSoon(activeCaps.id) ? "Future channel reserved" : "Caption adaptation channel online"
                : copy.line}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <ul className="entrance-platform-rail absolute inset-x-0 bottom-[max(18px,env(safe-area-inset-bottom))] z-20 mx-auto grid max-w-[920px] grid-cols-3 gap-1.5 px-4 sm:grid-cols-6 sm:gap-2 sm:px-8">
        {PLATFORM_ORDER.map((platform, index) => {
          const caps = PLATFORM_CAPABILITIES[platform];
          const comingSoon = isComingSoon(platform);
          const selected = !comingSoon && (hoveredPlatform === platform || running);
          return (
            <li key={platform}>
              <button
                type="button"
                disabled={running || comingSoon}
                onPointerEnter={() => setExplorationTarget(platform)}
                onPointerLeave={() => setExplorationTarget(null)}
                onFocus={() => setExplorationTarget(platform)}
                onBlur={() => setExplorationTarget(null)}
                className="entrance-platform-signal group w-full"
                style={{ "--entrance-accent": caps.accent, "--entrance-delay": `${index * 70}ms` } as React.CSSProperties}
                aria-label={comingSoon ? `${caps.label} coming soon` : `Inspect ${caps.label} signal`}
              >
                <span
                  className="entrance-platform-rune is-word"
                  style={{ color: "var(--starlight-dim)" }}
                >
                  {caps.label}
                </span>
                <span className="min-w-0">
                  <span className={selected ? "entrance-signal-status is-active" : "entrance-signal-status"}>
                    {platformStatus(platform)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="pointer-events-none absolute bottom-5 left-7 z-10 hidden telemetry text-[8px] uppercase tracking-[0.14em] text-starlight-faint lg:block">
        <span>Core: nominal</span>
        <span className="mx-3 text-neon/60">◆</span>
        <span>Time axis: unlocked</span>
      </div>

      <AnimatePresence>
        {webGL && !reducedMotion && !stageReady && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-void-0"
          >
            <div className="text-center">
              <MiniTesseract size={42} state="transmitting" />
              <p className="mt-3 telemetry text-[9px] uppercase tracking-[0.2em] text-neon">Assembling relic</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(phase === "portal" || phase === "navigating") && (
          <motion.div className="pointer-events-none absolute inset-0 z-50 overflow-hidden" aria-hidden>
            <motion.div
              initial={{ scale: 0.03, opacity: 0 }}
              animate={{ scale: reducedMotion ? 8 : [0.03, 0.3, 1.2, 8], opacity: [0, 1, 1, 1] }}
              transition={{ duration: reducedMotion ? 0.16 : 0.82, times: [0, 0.18, 0.58, 1], ease: [0.65, 0, 0.35, 1] }}
              className="entrance-portal-aperture absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: phase === "navigating" ? 1 : [0, 0, 0.96] }}
              transition={{ duration: reducedMotion ? 0.16 : 0.86, times: [0, 0.72, 1] }}
              className="absolute inset-0 bg-void-0"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sr-only">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
      </div>
    </main>
  );
}
