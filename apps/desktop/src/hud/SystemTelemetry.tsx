import type { VidtryxPhase } from "../state/types";
import type { CSSProperties } from "react";

type SystemTelemetryProps = {
  phase: VidtryxPhase;
  color: string;
  stageProgress: number;
};

const bars = Array.from({ length: 34 }, (_, index) => 18 + ((index * 19) % 58));

export function SystemTelemetry({ phase, color, stageProgress }: SystemTelemetryProps) {
  const load = phase === "running" ? Math.round(48 + stageProgress * 44) : phase === "complete" ? 100 : 18;

  return (
    <section className="telemetry-panel hud-panel">
      <div className="panel-kicker">
        <span>Signal</span>
      </div>
      <div className="waveform" aria-hidden="true">
        {bars.map((height, index) => (
          <span
            key={index}
            style={{
              height: `${phase === "running" ? Math.max(10, height * (0.65 + stageProgress)) : height * 0.42}px`,
              background: color,
            }}
          />
        ))}
      </div>
      <div className="load-ring" style={{ "--load": `${load}%`, "--accent": color } as CSSProperties}>
        <strong>{load}%</strong>
        <small>Load</small>
      </div>
    </section>
  );
}
