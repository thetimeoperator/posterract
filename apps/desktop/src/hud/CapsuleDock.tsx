import clsx from "clsx";
import { Box, CalendarClock } from "lucide-react";
import { motion } from "framer-motion";
import type { ContentCapsule } from "../state/types";

type CapsuleDockProps = {
  capsules: ContentCapsule[];
  selectedCapsuleId?: string;
  onSelectCapsule: (capsuleId: string) => void;
  onOpenPost: (capsuleId: string) => void;
};

export function CapsuleDock({ capsules, selectedCapsuleId, onSelectCapsule, onOpenPost }: CapsuleDockProps) {
  return (
    <motion.section
      className="capsule-dock hud-panel"
      initial={{ y: 42, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.55, ease: "easeOut", delay: 0.12 }}
    >
      <div className="panel-kicker">
        <Box size={14} />
        <span>Content Capsules</span>
      </div>
      <div className="capsule-dock__rail" data-testid="capsule-dock">
        {capsules.slice(0, 5).map((capsule) => (
          <button
            key={capsule.id}
            className={clsx("capsule-chip", capsule.id === selectedCapsuleId && "is-selected")}
            type="button"
            onClick={() => {
              onSelectCapsule(capsule.id);
              onOpenPost(capsule.id);
            }}
          >
            <span className="capsule-orb" style={{ background: capsule.thumbnailTone }} />
            <span>
              <strong>{capsule.title}</strong>
              <small>
                <CalendarClock size={12} />
                {capsule.status}
              </small>
            </span>
          </button>
        ))}
      </div>
    </motion.section>
  );
}
