import { CalendarClock, Clapperboard, Send, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import type { ContentCapsule, PlatformAccount, PublishJob } from "../state/types";

type HomeActionsProps = {
  capsules: ContentCapsule[];
  platformAccounts: PlatformAccount[];
  publishJobs: PublishJob[];
  onCreate: () => void;
  onPost: () => void;
};

export function HomeActions({ capsules, platformAccounts, publishJobs, onCreate, onPost }: HomeActionsProps) {
  const readyCapsules = capsules.filter((capsule) => capsule.status === "ready").length;
  const connectedPlatforms = platformAccounts.filter((account) => account.connected).length;
  const scheduledJobs = publishJobs.filter((job) => job.status === "scheduled").length;

  return (
    <>
      <motion.section
        className="home-action home-action--create hud-panel"
        initial={{ x: -34, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
      >
        <div className="panel-kicker">
          <Sparkles size={14} />
          <span>Create power</span>
        </div>
        <h1>Create</h1>
        <p>Activate a content mode, give Vidtryx a prompt or files, and generate a finished capsule.</p>
        <div className="home-action__stats">
          <span>{readyCapsules} ready capsules</span>
          <span>Mode core armed</span>
        </div>
        <button data-testid="open-create" className="power-button" type="button" onClick={onCreate}>
          <Clapperboard size={18} />
          Open Create
        </button>
      </motion.section>

      <motion.section
        className="home-action home-action--post hud-panel"
        initial={{ x: 34, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: "easeOut", delay: 0.06 }}
      >
        <div className="panel-kicker">
          <Send size={14} />
          <span>Post power</span>
        </div>
        <h1>Post</h1>
        <p>Choose a capsule, target connected platforms, then publish now or schedule it for launch.</p>
        <div className="home-action__stats">
          <span>{connectedPlatforms} platforms online</span>
          <span>
            <CalendarClock size={13} />
            {scheduledJobs} scheduled
          </span>
        </div>
        <button data-testid="open-post" className="power-button power-button--post" type="button" onClick={onPost}>
          <Send size={18} />
          Open Post
        </button>
      </motion.section>
    </>
  );
}
