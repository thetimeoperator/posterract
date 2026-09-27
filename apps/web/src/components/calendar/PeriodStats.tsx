import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Eye, Flame, Send, Trophy } from "lucide-react";
import clsx from "clsx";
import { levelProgress } from "@posterract/contract";
import { usePeriodStats, usePoints } from "@/engine/useEngine";

/**
 * The calendar's numbers for the month or week on screen: points, views,
 * the posting streak and posts. They follow the period you move to and the
 * business picked in the header.
 */

const compact = (value: number) => value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 });

function Change({ value, previous }: { value: number; previous: number }) {
  if (!previous) return value > 0 ? <span className="period-stat-change is-up">new</span> : null;
  const change = (value - previous) / previous;
  const up = change >= 0;
  return (
    <span className={clsx("period-stat-change", up ? "is-up" : "is-down")}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(Math.round(change * 100))}%
    </span>
  );
}

function Bars({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  return (
    <span className="period-stat-bars" aria-hidden>
      {values.slice(-31).map((value, index) => <i key={index} style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />)}
    </span>
  );
}

export function PeriodStats({ from, to, label, businessId, posted, scheduled }: {
  /** Local dates, inclusive: the first and last day on screen. */
  from: string;
  to: string;
  label: string;
  businessId?: string;
  posted: number;
  scheduled: number;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stats = usePeriodStats({ from, to, timeZone, businessId });
  const summary = usePoints();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const future = from > todayKey;
  const level = summary ? levelProgress(summary.lifetimeRP) : undefined;
  const toNext = level && level.next !== null && summary ? Math.max(0, Math.round(level.next - summary.lifetimeRP)) : undefined;
  const streak = stats?.streak;

  return (
    <section className="period-stats" aria-label={`${label} at a glance`}>
      <p className="period-stats-label">{label}</p>
      <div className="period-stats-grid">
        <Link to="/points" className="period-stat">
          <span className="period-stat-head"><Trophy size={12} />Points</span>
          <span className="period-stat-value">{future || !stats ? "—" : compact(stats.points)}{stats && !future && <Change value={stats.points} previous={stats.previousPoints} />}</span>
          <span className="period-stat-foot">{level ? `Level ${level.level}${toNext !== undefined ? ` · ${compact(toNext)} to ${level.level + 1}` : ""}` : " "}</span>
        </Link>
        <Link to="/echoes" className="period-stat">
          <span className="period-stat-head"><Eye size={12} />Views</span>
          <span className="period-stat-value">{future || !stats ? "—" : compact(stats.views)}{stats && !future && <Change value={stats.views} previous={stats.previousViews} />}</span>
          {stats && !future && stats.dailyViews.length > 1 ? <Bars values={stats.dailyViews.map((day) => day.views)} /> : <span className="period-stat-foot">{future ? "Not yet" : " "}</span>}
        </Link>
        <Link to="/points" className="period-stat">
          <span className="period-stat-head"><Flame size={12} />Streak</span>
          <span className="period-stat-value">{streak ? `${streak.days} day${streak.days === 1 ? "" : "s"}` : "—"}</span>
          <span className={clsx("period-stat-foot", streak && !streak.postedToday && streak.days > 0 && "is-due")}>
            {!streak ? " " : streak.postedToday ? "Posted today ✓" : streak.days > 0 ? "Post today to keep it" : "Post to start one"}
          </span>
        </Link>
        <div className="period-stat">
          <span className="period-stat-head"><Send size={12} />Posts</span>
          <span className="period-stat-value">{posted} posted</span>
          <span className="period-stat-foot">{scheduled} scheduled</span>
        </div>
      </div>
    </section>
  );
}
