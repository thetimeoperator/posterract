import { Activity, CircleDot, RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import type { VidtryxMode, VidtryxPhase } from "../state/types";

type ModePanelProps = {
  mode: VidtryxMode;
  phase: VidtryxPhase;
  progress: number;
  status: string;
  runId?: string;
  onReset: () => void;
};

export function ModePanel({ mode, phase, progress, status, runId, onReset }: ModePanelProps) {
  return (
    <motion.aside
      className="mode-panel hud-panel"
      initial={{ x: -34, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <div className="panel-kicker">
        <CircleDot size={14} />
        <span>VIDTRYX</span>
      </div>
      <h1>{mode.name}</h1>
      <p>{mode.description}</p>

      <div className="mode-readout">
        <div>
          <small>State</small>
          <strong>{phase.toUpperCase()}</strong>
        </div>
        <div>
          <small>Core</small>
          <strong>{status}</strong>
        </div>
      </div>

      <div className="system-meter">
        <div className="system-meter__top">
          <span>Run charge</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <div className="meter-track">
          <span style={{ width: `${Math.max(2, progress * 100)}%`, background: mode.color }} />
        </div>
      </div>

      <div className="mode-footer">
        <span>
          <Activity size={14} />
          {runId ? runId : "ready"}
        </span>
        {(phase === "complete" || phase === "failed") && (
          <button className="ghost-button" type="button" onClick={onReset}>
            <RotateCcw size={14} />
            Reset
          </button>
        )}
      </div>
    </motion.aside>
  );
}
