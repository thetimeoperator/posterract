import clsx from "clsx";
import { Box, Clock3, Upload } from "lucide-react";
import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { ContentCapsule } from "../state/types";

type CapsuleShelfProps = {
  capsules: ContentCapsule[];
  selectedCapsuleId?: string;
  onSelectCapsule: (capsuleId: string) => void;
};

export function CapsuleShelf({ capsules, selectedCapsuleId, onSelectCapsule }: CapsuleShelfProps) {
  return (
    <motion.aside
      className="capsule-shelf hud-panel"
      initial={{ x: -34, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <div className="panel-kicker">
        <Box size={14} />
        <span>Capsule Vault</span>
      </div>
      <div className="capsule-shelf__list" data-testid="capsule-shelf">
        {capsules.map((capsule) => (
          <button
            key={capsule.id}
            className={clsx("capsule-card", capsule.id === selectedCapsuleId && "is-selected")}
            type="button"
            onClick={() => onSelectCapsule(capsule.id)}
          >
            <span className="capsule-card__thumb" style={{ "--capsule-tone": capsule.thumbnailTone } as CSSProperties}>
              {capsule.duration}
            </span>
            <span className="capsule-card__body">
              <strong>{capsule.title}</strong>
              <small>
                <Clock3 size={12} />
                {capsule.status} / {capsule.aspect}
              </small>
            </span>
          </button>
        ))}
      </div>
      <button
        className="ghost-button capsule-upload"
        type="button"
        disabled
        aria-label="Upload capsule unavailable"
        title="Upload capsule unavailable"
      >
        <Upload size={14} />
        Upload unavailable
      </button>
    </motion.aside>
  );
}
