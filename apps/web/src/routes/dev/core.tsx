import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Segmented } from "@posterract/hyperkit";
import type { PlatformId } from "@posterract/contract";
import { PLATFORM_IDS } from "@posterract/contract";
import { DeviceStage } from "@/core3d/DeviceStage";
import type { CellVisualState, TesseractMode } from "@/tesseract/Tesseract";

export const Route = createFileRoute("/dev/core")({
  component: CoreLab,
});

const MODES: TesseractMode[] = ["idle", "composing", "scheduled", "publishing", "failure"];

/**
 * Core lab — cycle every mode; simulate a publish run where each
 * platform cell ignites in sequence (what the real engine will drive).
 */
function CoreLab() {
  const [mode, setMode] = useState<TesseractMode>("idle");
  const [cellStates, setCellStates] = useState<Partial<Record<PlatformId, CellVisualState>>>({
    instagram: "connected",
    tiktok: "connected",
    youtube: "connected",
    x: "connected",
    threads: "dark",
    facebook: "dark",
  });
  const [running, setRunning] = useState(false);

  // Simulated publish: unfold, ignite cells one by one, refold.
  useEffect(() => {
    if (!running) return;
    const targets: PlatformId[] = ["instagram", "tiktok", "youtube", "x"];
    const timers: ReturnType<typeof setTimeout>[] = [];
    setMode("publishing");
    targets.forEach((p, i) => {
      timers.push(
        setTimeout(() => setCellStates((s) => ({ ...s, [p]: "igniting" })), 1400 + i * 900),
      );
      timers.push(
        setTimeout(() => setCellStates((s) => ({ ...s, [p]: "live" })), 2100 + i * 900),
      );
    });
    timers.push(
      setTimeout(() => {
        setMode("idle");
        setRunning(false);
      }, 1400 + targets.length * 900 + 1600),
    );
    return () => timers.forEach(clearTimeout);
  }, [running]);

  return (
    <div className="relative min-h-screen bg-void-0">
      <div className="absolute inset-0">
        <DeviceStage mode={mode} cellStates={cellStates} className="h-full w-full" />
      </div>

      <div className="relative z-10 flex flex-col gap-4 p-6">
        <p className="kicker">Core lab</p>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            aria-label="Mode"
            value={mode}
            onChange={(m) => setMode(m)}
            options={MODES.map((m) => ({ value: m, label: m }))}
          />
          <Button variant="primary" onClick={() => setRunning(true)} disabled={running}>
            Simulate publish run
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORM_IDS.map((p) => (
            <Button
              key={p}
              size="sm"
              onClick={() =>
                setCellStates((s) => {
                  const order: CellVisualState[] = ["dark", "connected", "igniting", "live", "failed"];
                  const next = order[(order.indexOf(s[p] ?? "dark") + 1) % order.length];
                  return { ...s, [p]: next };
                })
              }
            >
              {p}: {cellStates[p] ?? "dark"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
