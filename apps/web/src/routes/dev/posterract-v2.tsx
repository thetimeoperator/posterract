import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { RotateCcw, Sparkles, Zap } from "lucide-react";
import { Button, Starfield } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PLATFORM_ORDER, type PlatformId } from "@posterract/contract";
import { RelicStage } from "@/core3d/v2/RelicStage";
import type { RelicMode, RelicPodState } from "@/core3d/v2/PosterractRelic";

export const Route = createFileRoute("/dev/posterract-v2")({
  component: PosterractV2Lab,
});

const MODES: RelicMode[] = ["idle", "composing", "scheduled", "publishing", "failure", "ascended"];

const INITIAL_STATES: Record<PlatformId, RelicPodState> = {
  instagram: "ready",
  tiktok: "ready",
  youtube: "ready",
  x: "offline",
  threads: "offline",
  facebook: "offline",
};

function PosterractV2Lab() {
  const [mode, setMode] = useState<RelicMode>("idle");
  const [podStates, setPodStates] = useState<Record<PlatformId, RelicPodState>>(INITIAL_STATES);
  const [hoveredPlatform, setHoveredPlatform] = useState<PlatformId | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setMode("publishing");
    setPodStates(Object.fromEntries(PLATFORM_ORDER.map((platform) => [platform, "ready"])) as Record<PlatformId, RelicPodState>);
    PLATFORM_ORDER.forEach((platform, index) => {
      timers.push(setTimeout(() => setPodStates((current) => ({ ...current, [platform]: "active" })), 700 + index * 650));
      timers.push(setTimeout(() => setPodStates((current) => ({ ...current, [platform]: "complete" })), 1250 + index * 650));
    });
    timers.push(setTimeout(() => setMode("ascended"), 1500 + PLATFORM_ORDER.length * 650));
    timers.push(
      setTimeout(() => {
        setMode("idle");
        setRunning(false);
      }, 4200 + PLATFORM_ORDER.length * 650),
    );
    return () => timers.forEach(clearTimeout);
  }, [running]);

  const activeCaps = useMemo(
    () => (hoveredPlatform ? PLATFORM_CAPABILITIES[hoveredPlatform] : null),
    [hoveredPlatform],
  );

  const reset = () => {
    setRunning(false);
    setMode("idle");
    setPodStates(INITIAL_STATES);
    setHoveredPlatform(null);
  };

  return (
    <main className="relative h-screen min-h-[720px] overflow-hidden bg-void-0 text-starlight">
      <div className="chamber-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="pointer-events-none absolute inset-0 opacity-55">
        <Starfield />
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(circle at 50% 48%, rgba(101,255,154,0.14), transparent 24%), radial-gradient(circle at 50% 110%, rgba(124,247,255,0.08), transparent 38%)",
        }}
      />

      <RelicStage
        mode={mode}
        podStates={podStates}
        hoveredPlatform={hoveredPlatform}
        onPlatformHover={setHoveredPlatform}
        className="absolute inset-0"
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-7">
        <div>
          <p className="kicker !text-neon">Experimental device study · V2</p>
          <h1 className="mt-1 font-display text-[23px] font-bold tracking-[0.2em] text-starlight">
            POSTER<span className="text-neon">RACT</span>
          </h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-starlight-faint">
            The impossible publishing relic
          </p>
        </div>
        <div className="telemetry text-right text-[10px] uppercase tracking-[0.15em] text-starlight-faint">
          <p>Model laboratory</p>
          <p className="mt-1 text-neon">Unauthenticated preview</p>
        </div>
      </header>

      <section className="glass absolute bottom-7 left-7 z-10 w-[330px] rounded-[var(--radius-panel)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="kicker">Device state</p>
            <p className="mt-0.5 font-display text-[14px] font-semibold capitalize text-starlight">{mode}</p>
          </div>
          <Button size="sm" variant="secondary" onClick={reset} icon={<RotateCcw size={12} />}>
            Reset
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Device mode">
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setRunning(false);
                setMode(value);
              }}
              className={clsx(
                "h-8 rounded-[8px] border px-2 font-display text-[10px] font-semibold uppercase tracking-[0.08em] transition-all",
                mode === value
                  ? "border-[rgba(101,255,154,0.55)] bg-[rgba(101,255,154,0.1)] text-neon shadow-glow-neon-sm"
                  : "border-[var(--glass-border)] text-starlight-faint hover:border-[var(--glass-border-bright)] hover:text-starlight",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          className="mt-3 w-full"
          icon={running ? <Zap size={14} /> : <Sparkles size={14} />}
          disabled={running}
          onClick={() => setRunning(true)}
        >
          {running ? "Transmission running" : "Run full transmission"}
        </Button>
      </section>

      <aside className="glass absolute right-7 top-1/2 z-10 w-[260px] -translate-y-1/2 rounded-[var(--radius-panel)] p-4">
        <p className="kicker">Six chambers</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-starlight-faint">
          Hover a chamber or use the controls below to inspect its signal.
        </p>
        <ul className="mt-3 space-y-1.5">
          {PLATFORM_ORDER.map((platform) => {
            const caps = PLATFORM_CAPABILITIES[platform];
            const state = podStates[platform];
            return (
              <li key={platform}>
                <button
                  type="button"
                  onMouseEnter={() => setHoveredPlatform(platform)}
                  onMouseLeave={() => setHoveredPlatform(null)}
                  onClick={() => {
                    const sequence: RelicPodState[] = ["offline", "ready", "active", "complete", "failed"];
                    setPodStates((current) => ({
                      ...current,
                      [platform]: sequence[(sequence.indexOf(current[platform]) + 1) % sequence.length],
                    }));
                  }}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-[9px] border px-2.5 py-2 text-left transition-all",
                    hoveredPlatform === platform
                      ? "border-[var(--glass-border-bright)] bg-[rgba(101,255,154,0.07)]"
                      : "border-transparent hover:border-[var(--glass-border)]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-starlight-dim">{caps.label}</span>
                  <span
                    className={clsx(
                      "telemetry text-[9px] uppercase tracking-[0.08em]",
                      state === "complete" && "text-auroral",
                      state === "active" && "text-ice",
                      state === "failed" && "text-redshift",
                      state === "ready" && "text-starlight-dim",
                      state === "offline" && "text-starlight-faint",
                    )}
                  >
                    {state}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 min-h-10 border-t border-[var(--glass-border)] pt-3">
          <p className="telemetry text-[10px] uppercase tracking-[0.12em] text-neon">
            {activeCaps ? activeCaps.label : "Relic locked to center"}
          </p>
          <p className="mt-1 text-[10.5px] text-starlight-faint">
            {activeCaps ? `${activeCaps.video.maxDurationS}s max · ${activeCaps.video.maxSizeMB} MB` : "Hover a chamber to inspect its signal"}
          </p>
        </div>
      </aside>

      <div className="pointer-events-none absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-center">
        <p className="telemetry text-[9px] uppercase tracking-[0.22em] text-starlight-faint">
          One artifact · six projections · time is the fourth dimension
        </p>
      </div>
    </main>
  );
}
