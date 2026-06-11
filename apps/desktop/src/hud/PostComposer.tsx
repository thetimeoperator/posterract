import clsx from "clsx";
import { CalendarClock, Clock, Send } from "lucide-react";
import { motion } from "framer-motion";
import { formatShortDateTime, fromDatetimeLocalValue, toDatetimeLocalValue } from "../lib/format";
import type { ContentCapsule, ScheduleMode } from "../state/types";

type PostComposerProps = {
  capsule?: ContentCapsule;
  caption: string;
  scheduleMode: ScheduleMode;
  scheduledFor: string;
  selectedPlatformCount: number;
  onCaptionChange: (caption: string) => void;
  onScheduleModeChange: (mode: ScheduleMode) => void;
  onScheduledForChange: (iso: string) => void;
  onSchedulePublish: () => void;
};

export function PostComposer({
  capsule,
  caption,
  scheduleMode,
  scheduledFor,
  selectedPlatformCount,
  onCaptionChange,
  onScheduleModeChange,
  onScheduledForChange,
  onSchedulePublish,
}: PostComposerProps) {
  const capsuleBlockReason = !capsule
    ? "Select a capsule"
    : capsule.status === "draft"
      ? "Draft capsule cannot be scheduled"
      : !capsule.outputUrl
        ? "Media required before scheduling"
        : undefined;
  const capsuleCanPublish = !capsuleBlockReason;
  const disabled = !capsuleCanPublish || selectedPlatformCount === 0;
  const footerStatus =
    capsuleBlockReason ??
    (selectedPlatformCount === 0
      ? "Select connected platforms"
      : scheduleMode === "now"
        ? "Immediate publish handoff"
        : `Queued for ${formatShortDateTime(scheduledFor)}`);

  return (
    <motion.section
      className={clsx("post-composer hud-panel", !capsuleCanPublish && "is-blocked")}
      initial={{ y: 42, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <div className="post-composer__meta">
        <div className="panel-kicker">
          <Send size={14} />
          <span>Launch Package</span>
        </div>
        <strong>{capsule?.title ?? "Select a capsule"}</strong>
      </div>

      <textarea
        data-testid="post-caption"
        value={caption}
        disabled={!capsule}
        onChange={(event) => onCaptionChange(event.target.value)}
        placeholder="Caption for the selected platforms..."
        rows={3}
      />

      <div className="schedule-strip">
        <div className="segmented-control" aria-label="Publish time">
          <button
            className={clsx(scheduleMode === "now" && "is-active")}
            type="button"
            onClick={() => onScheduleModeChange("now")}
          >
            <Send size={14} />
            Now
          </button>
          <button
            className={clsx(scheduleMode === "later" && "is-active")}
            type="button"
            onClick={() => onScheduleModeChange("later")}
          >
            <CalendarClock size={14} />
            Schedule
          </button>
        </div>

        <label className="schedule-input">
          <Clock size={14} />
          <input
            data-testid="schedule-time"
            type="datetime-local"
            value={toDatetimeLocalValue(scheduledFor)}
            disabled={!capsuleCanPublish || scheduleMode === "now"}
            onChange={(event) => onScheduledForChange(fromDatetimeLocalValue(event.target.value))}
          />
        </label>

        <button
          data-testid="schedule-publish"
          className="generate-button post-submit"
          type="button"
          disabled={disabled}
          onClick={onSchedulePublish}
        >
          <Send size={18} />
          {scheduleMode === "now" ? "Post Now" : "Schedule"}
        </button>
      </div>

      <div className="post-composer__footer">
        <span>{selectedPlatformCount} selected connected platforms</span>
        <span>{footerStatus}</span>
      </div>
    </motion.section>
  );
}
