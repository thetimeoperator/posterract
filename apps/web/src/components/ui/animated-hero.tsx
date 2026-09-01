import { MoveRight } from "lucide-react";
import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";

const HERO_PLATFORMS = [
  { id: "instagram", name: "Instagram", mark: PLATFORM_MARK_SOURCES.instagram },
  { id: "tiktok", name: "TikTok", mark: PLATFORM_MARK_SOURCES.tiktok },
  { id: "facebook", name: "Facebook", mark: PLATFORM_MARK_SOURCES.facebook },
  { id: "threads", name: "Threads", mark: PLATFORM_MARK_SOURCES.threads },
  { id: "youtube", name: "YouTube", mark: PLATFORM_MARK_SOURCES.youtube },
  { id: "x", name: "X", mark: PLATFORM_MARK_SOURCES.x },
  { id: "linkedin", name: "LinkedIn", mark: PLATFORM_MARK_SOURCES.linkedin },
  { id: "reddit", name: "Reddit", mark: PLATFORM_MARK_SOURCES.reddit },
] as const;

type HeroProps = {
  onLaunch: () => void;
};

export function Hero({ onLaunch }: HeroProps) {
  return (
    <div className="site-hero-copy site-hero-copy-centered">
      <a className="site-hero-pill" href="#platforms">
        <span>Where your agent uploads</span>
        <MoveRight aria-hidden="true" size={14} strokeWidth={1.8} />
      </a>

      <div className="site-hero-message">
        <p className="site-kicker">THE AGENT-FIRST SOCIAL MEDIA SCHEDULER</p>
        <h1 id="site-title" aria-label="Create and Schedule Content with your AI Agent">
          <span className="site-hero-title-line">Create and Schedule Content</span>
          <span className="site-hero-title-line">with your AI Agent</span>
        </h1>

        <p className="site-hero-lede">
          The Posterract is an agent harness that lets you connect your agent, create content,
          and schedule it across all platforms.
        </p>

        <div className="site-hero-platforms" aria-label="Posterract social platform network">
          {HERO_PLATFORMS.map((platform) => (
            <span data-platform={platform.id} title={platform.name} key={platform.id}>
              <img src={platform.mark} alt={`${platform.name} logo`} />
            </span>
          ))}
        </div>
      </div>

      <div className="site-actions site-actions-centered">
        <button className="site-primary" type="button" onClick={onLaunch}>
          Launch Posterract
          <MoveRight aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
        <a className="site-secondary" href="#roadmap">
          Explore the roadmap
        </a>
      </div>

      <p className="site-live site-live-centered">
        <span /> Publishing live on Instagram, Facebook, and Threads.
      </p>
    </div>
  );
}
