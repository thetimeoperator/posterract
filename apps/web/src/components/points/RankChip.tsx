import { Link } from "@tanstack/react-router";
import { levelProgress, rankForLevel } from "@posterract/contract";
import { usePoints, usePointsReady } from "@/engine/useEngine";
import { RankEmblem, TIER_MATERIALS } from "./RankEmblem";

const whole = (value: number) => Math.round(value).toLocaleString();

/** The user's rank and level in the header of every tab, with progress to the next level. Opens the Points tab. */
export function RankChip() {
  const points = usePoints();
  const ready = usePointsReady();
  if (!ready || !points) return null;
  const { level, next, progress } = levelProgress(points.lifetimeRP);
  const rank = rankForLevel(level);
  const ink = TIER_MATERIALS[rank.tier].ink;
  const toNext = next === null ? undefined : Math.max(0, next - points.lifetimeRP);
  const detail = `${rank.label} · Level ${level} · ${whole(points.lifetimeRP)} points${toNext === undefined ? "" : ` · ${whole(toNext)} to level ${level + 1}`}`;
  return (
    <Link to="/points" title={detail} aria-label={`Your rank: ${rank.label}, level ${level}. Open Points`} className="app-header-rank">
      <RankEmblem level={level} size={26} glow={false} />
      <span className="app-header-rank-text">
        <span className="app-header-rank-name font-display" style={{ color: ink[0] }}>{rank.label}</span>
        <span className="app-header-rank-level font-mono">LVL {level}</span>
        <span className="app-header-rank-bar" aria-hidden><span style={{ width: `${Math.round(progress * 100)}%`, background: ink[1] }} /></span>
      </span>
    </Link>
  );
}
