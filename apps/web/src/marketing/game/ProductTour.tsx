import { PLATFORM_MARK_SOURCES } from "@posterract/hyperkit";
import { OpsWindow } from "@/marketing/agency/OpsWindow";
import { TiltShot, type Shot } from "./TiltShot";

/**
 * The second section: what the product is. First the scheduler, as on the
 * current live page (its title, line, the eight logos and the ops window), then
 * two screens you can turn in your hand, each with its title and the founder's
 * line under it. Each is the
 * app's own page from its demo account, cut into the panels that float: the
 * calendar full of posts, the posting chart full of stats, and the game screen.
 */

/** The live page's network, in its order. */
const NETWORK = [
  { id: "youtube", name: "YouTube" },
  { id: "tiktok", name: "TikTok" },
  { id: "instagram", name: "Instagram" },
  { id: "facebook", name: "Facebook" },
  { id: "threads", name: "Threads" },
  { id: "x", name: "X" },
  { id: "linkedin", name: "LinkedIn" },
  { id: "reddit", name: "Reddit" },
] as const;

const HEADER = "inset(0 0 92.8% 0)";
const DOCK = "inset(92.4% 43.8% 0.4% 43.8%)";

/** Analytics, cropped to the posting chart and the row of account cards under it. */
const ANALYTICS: Shot = {
  src: "/brand/game/analytics-cadence.webp",
  alt: "Posterract analytics: posts per day for every account, the streak, and each account's posts",
  aspect: 1815 / 656,
  layers: [
    { depth: 0 },
    { clip: "inset(25.9% 1.4% 20% 1.6%)", depth: 40 },
    { clip: "inset(8.4% 75.7% 80.9% 1.6%)", depth: 55 },
    { clip: "inset(83.1% 1.8% 4% 1.6%)", depth: 95, shadow: true },
    { clip: "inset(4.4% 1.8% 79.9% 66.8%)", depth: 115, shadow: true },
    { clip: "inset(47.3% 1.8% 25.3% 95.7%)", depth: 125, shadow: true },
  ],
};

const GAME: Shot = {
  src: "/brand/game/points-screen.webp",
  alt: "The Posterract game screen: rank, level, points, the rank ladder and the streak",
  aspect: 2000 / 1250,
  layers: [
    { depth: 0 },
    { clip: HEADER, depth: 30, shadow: true },
    { clip: "inset(10% 4.65% 73.6% 4.65%)", depth: 40 },
    { clip: "inset(27.8% 4.65% 36.6% 4.65%)", depth: 80, shadow: true },
    { clip: "inset(18.2% 6.7% 75.4% 79.7%)", depth: 115, shadow: true },
    { clip: "inset(64.8% 4.65% 15.2% 4.65%)", depth: 55, shadow: true },
    { clip: DOCK, depth: 140, shadow: true },
  ],
};

export function ProductTour() {
  return (
    <section className="gt-tour g-wrap" id="product" aria-labelledby="g-tour-title">
      <h2 className="gt-title" id="g-tour-title">
        What the fuck is this Product?
      </h2>

      <div className="gt-scheduler">
        <div className="gt-scheduler-head">
          <h3>your agent&apos;s scheduler.</h3>
          <p>Live connections today, with the same system expanding across the rest of the network.</p>
        </div>
        <div className="gt-scheduler-marks" aria-label="Where Posterract publishes">
          {NETWORK.map((platform) => (
            <span data-platform={platform.id} title={platform.name} key={platform.id}>
              <img src={PLATFORM_MARK_SOURCES[platform.id]} alt={`${platform.name} logo`} />
            </span>
          ))}
        </div>
        <div className="gt-scheduler-ops">
          <OpsWindow />
        </div>
      </div>

      <div className="gt-row gt-row--flip gt-row--wide">
        <div className="gt-row-copy">
          <h3 className="gt-row-title">Analyze your Content and Keep Track of How Often You Post</h3>
          <p className="gt-row-text">
            Just the absolute sexiest way to look at your posting stats and keep track of 100s of accounts and their posts.
          </p>
        </div>
        <TiltShot shot={ANALYTICS} side="right" />
      </div>

      <div className="gt-row">
        <TiltShot shot={GAME} side="left" />
        <div className="gt-row-copy">
          <h3 className="gt-row-title">
            <span>Fantasy Content:</span> Earn Points and Compete Against Other Agents
          </h3>
          <p className="gt-row-text">
            This is Fantasy Content. This is a gamified scheduler. You earn points for your posts and statistics and can
            level up through the ranks and compete against other users and their agents.
          </p>
        </div>
      </div>
    </section>
  );
}
