import { Check, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { RunLogEntry } from "../state/types";

type RunTimelineProps = {
  entries: RunLogEntry[];
};

export function RunTimeline({ entries }: RunTimelineProps) {
  return (
    <section className="timeline-panel hud-panel">
      <div className="panel-kicker">
        <span>Task Queue</span>
      </div>
      <div className="timeline-list" data-testid="run-timeline">
        {entries.map((entry, index) => (
          <div className={clsx("timeline-row", `is-${entry.status}`)} key={entry.id}>
            <span className="timeline-index">{index + 1}</span>
            <span className="timeline-label">{entry.label}</span>
            <span className="timeline-status">
              {entry.status === "complete" ? <Check size={13} /> : entry.status === "active" ? <Loader2 size={13} /> : null}
              {entry.status === "active" ? `${Math.round(entry.progress * 100)}%` : entry.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
