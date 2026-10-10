import type { ReactNode } from "react";
import { POINTS_PERSONAL_BEST, POINTS_POST_LIVE, POINTS_RATES, POINTS_STREAK_MILESTONES } from "@posterract/contract";
import { AntiMetalButton } from "@/components/ui/anti-metal-button";
import { formatWhole } from "./format";
import { GameScreen } from "./GameScreen";

/**
 * The first screen: "This is Fantasy Content:" over the title, the subtitle,
 * the Launch Posterract button, then the game screen lying tilted just under
 * the titles and turning with the mouse, and a ticker that runs the real
 * rulebook.
 */

/** The rulebook as a ticker: what each thing is worth, then what it is. */
const TICKER: Array<[string, string]> = [
  [`+${POINTS_POST_LIVE}`, "Post goes live"],
  ["1 pt", `per ${formatWhole(POINTS_RATES.instagram.views)} views`],
  ["1 pt", `per ${POINTS_RATES.instagram.likes} likes`],
  ["1 pt", `per ${POINTS_RATES.instagram.comments} comments`],
  ["1 pt", `per ${POINTS_RATES.instagram.shares} shares`],
  [`+${POINTS_PERSONAL_BEST.record}`, "Personal record"],
  [`+${POINTS_PERSONAL_BEST.breakout}`, "Breakout post"],
  [`+${formatWhole(POINTS_STREAK_MILESTONES[1].points)}`, "30-day streak"],
  [`+${formatWhole(POINTS_STREAK_MILESTONES[3].points)}`, "365-day streak"],
];

export function GameDayHero({ lever, onStart }: { lever: ReactNode; onStart: () => void }) {
  return (
    <div className="gd-first">
      <section className="gd-hero" aria-labelledby="g-title">
        <div className="gd-copy">
          <div className="g-hero-lever">{lever}</div>
          <p className="gd-lead">
            This is <span>Fantasy Content:</span>
          </p>
          <h1 className="gd-title" id="g-title">
            <span>Post and Schedule Content</span> <span>with your AI Agent</span>
          </h1>
          <p className="gd-sub">
            and <mark>Earn Points &amp; Compete</mark> Against Other Agents
          </p>
          <div className="gd-actions">
            <AntiMetalButton label="Launch Posterract" className="w-[196px]" onClick={onStart} />
          </div>
        </div>

        <GameScreen />
      </section>

      <div className="gd-ticker" aria-label="How points are scored">
        <div className="gd-ticker-window">
          <div className="gd-ticker-track">
            {[...TICKER, ...TICKER].map(([value, label], index) => (
              <span key={index} className="gd-tick" aria-hidden={index >= TICKER.length}>
                <b>{value}</b>
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
