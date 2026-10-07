import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { PlatformBrandMark } from "@posterract/hyperkit";
import {
  PLATFORM_CAPABILITIES,
  POINTS_RATES,
  POINTS_SOURCE_LABELS,
  type PointsEntryDTO,
  type PointsSource,
  type PostPointsDTO,
} from "@posterract/contract";
import { HudDialog } from "./HudDialog";
import { PostThumb } from "./PostThumb";
import { formatCompact, formatPoints, relativeTime } from "./format";

/**
 * A post's stat card, opened from the Recent points feed: the video playing,
 * its numbers on its platform, where its points came from as a ring, and the
 * points it earned lately.
 */

/** Each rule's colour in the ring and its legend. */
const SOURCE_COLORS: Partial<Record<PointsSource, string>> = {
  watch: "#65ff9a",
  views: "#7cf7ff",
  saves: "#eafff3",
  likes: "#b8ffd4",
  comments: "#2fd47a",
  shares: "#9fd8cf",
  retention: "#8af8ff",
  record: "#ffd666",
  breakout: "#ffb347",
  post: "#56766b",
};

const C = 100;
const RING = 76;
const TICKS = Array.from({ length: 60 }, (_, index) => index);

/** A point on a circle, the angle in degrees clockwise from twelve o'clock. */
function point(r: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return `${(C + r * Math.sin(radians)).toFixed(2)} ${(C - r * Math.cos(radians)).toFixed(2)}`;
}

function arc(r: number, from: number, to: number) {
  return `M${point(r, from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(r, to)}`;
}

const count = (value?: number) => (value === undefined ? undefined : formatCompact(value));

/** How long a post has been up: "5 hours", "3 days". */
function liveFor(publishedAt: number) {
  const hours = Math.max(1, Math.round((Date.now() - publishedAt) / 3_600_000));
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}
const round2 = (value: number) => Math.round(value * 100) / 100;

export function PostStatCard({
  post,
  entries,
  rank,
  onClose,
}: {
  post: PostPointsDTO;
  /** The points it earned lately, newest first. */
  entries: PointsEntryDTO[];
  /** Its place among your best posts, when it is one of them. */
  rank?: number;
  onClose: () => void;
}) {
  const part = (source: PointsSource) => post.parts.find((item) => item.source === source);
  const metrics = post.metrics;
  const retention = metrics?.retention !== undefined ? metrics.retention * 100 : part("retention")?.value;
  const watchHours = metrics?.watchHours ?? part("watch")?.value;
  // A platform that never reports saves or watch time (TikTok, Threads) gets no empty boxes for them.
  const rates = POINTS_RATES[post.provider];
  const tiles: Array<{ label: string; value?: string; points?: number; reported?: boolean }> = [
    { label: "Views", value: count(metrics?.views ?? part("views")?.value), points: part("views")?.points },
    { label: "Likes", value: count(metrics?.likes ?? part("likes")?.value), points: part("likes")?.points },
    { label: "Comments", value: count(metrics?.comments ?? part("comments")?.value), points: part("comments")?.points },
    { label: "Shares", value: count(metrics?.shares ?? part("shares")?.value), points: part("shares")?.points },
    {
      label: "Saves",
      value: count(metrics?.saves ?? part("saves")?.value),
      points: part("saves")?.points,
      reported: Boolean(rates?.saves),
    },
    {
      label: "Watch time",
      value: watchHours === undefined ? undefined : `${formatPoints(Math.round(watchHours * 10) / 10)} h`,
      points: part("watch")?.points,
      reported: Boolean(rates?.watchHours),
    },
    {
      label: "Avg watch",
      value: metrics?.averageWatchSeconds === undefined ? undefined : `${metrics.averageWatchSeconds.toFixed(1)} s`,
      reported: Boolean(rates?.watchHours),
    },
    {
      label: "Retention",
      value: retention === undefined ? undefined : `${Math.round(retention)}%`,
      points: part("retention")?.points,
      reported: Boolean(rates?.watchHours),
    },
  ].filter((tile) => tile.value !== undefined || tile.reported !== false);

  // The ring: each rule's share of the post's points, biggest first, clockwise from twelve.
  const slices = post.parts.filter((item) => item.points > 0).sort((left, right) => right.points - left.points);
  const sum = slices.reduce((total, item) => total + item.points, 0);
  const gap = slices.length > 1 ? 2.4 : 0;
  let cursor = 0;
  const segments = slices.map((slice) => {
    const sweep = (slice.points / sum) * 360;
    const from = cursor + gap / 2;
    const to = Math.min(from + 359.9, Math.max(from + 0.8, cursor + sweep - gap / 2));
    cursor += sweep;
    return {
      ...slice,
      d: arc(RING, from, to),
      color: SOURCE_COLORS[slice.source] ?? "#93b8a8",
      share: sum > 0 ? slice.points / sum : 0,
    };
  });

  const lately = round2(entries.reduce((total, entry) => total + entry.amount, 0));
  const platform = PLATFORM_CAPABILITIES[post.provider].label;
  const facts = [
    {
      label: "Posted",
      value: post.publishedAt
        ? new Date(post.publishedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : undefined,
    },
    { label: "Live for", value: post.publishedAt ? liveFor(post.publishedAt) : undefined },
    { label: "Account", value: post.handle },
    { label: "Points", value: `${formatPoints(post.total)} total` },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return (
    <HudDialog className="stat-card" labelledBy="stat-card-title" onClose={onClose}>
      <div className="stat-card__media">
        <div className="stat-card__video">
          <PostThumb post={post} playing prefer="video" />
          <span className="stat-card__platform">
            <PlatformBrandMark platform={post.provider} height={14} decorative />
          </span>
        </div>
        <dl className="stat-card__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
        {post.url && (
          <a className="stat-card__open" href={post.url} target="_blank" rel="noreferrer">
            Open on {platform} <ArrowUpRight size={13} />
          </a>
        )}
      </div>

      <div className="stat-card__body">
        <header className="stat-card__head">
          <p className="stat-card__kicker">Post report</p>
          <h2 className="stat-card__title" id="stat-card-title">
            {post.title}
          </h2>
          <p className="stat-card__meta">{[platform, post.handle].filter(Boolean).join(" · ")}</p>
          <div className="stat-card__readouts">
            <span>
              <b className="stat-card__up">+{formatPoints(lately)}</b> earned lately
            </span>
            {rank !== undefined && (
              <span>
                <b>#{rank}</b> of your best posts
              </span>
            )}
            {entries[0] && (
              <span>
                Last points <b>{relativeTime(entries[0].at)}</b>
              </span>
            )}
          </div>
        </header>

        <div className="stat-tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className={tile.value === undefined ? "stat-tile stat-tile--empty" : "stat-tile"}>
              <p className="cr-label">{tile.label}</p>
              <p className="stat-tile__value">{tile.value ?? "—"}</p>
              <p className="stat-tile__pts">{tile.points ? `+${formatPoints(tile.points)} pts` : " "}</p>
            </div>
          ))}
        </div>

        <div className="stat-points">
          <div className="stat-ring">
            <svg viewBox="0 0 200 200" aria-hidden>
              <g className="stat-ring__ticks">
                {TICKS.map((index) => (
                  <line
                    key={index}
                    x1={C}
                    y1={4}
                    x2={C}
                    y2={index % 5 === 0 ? 12 : 8.5}
                    transform={`rotate(${index * 6} ${C} ${C})`}
                    className={index % 5 === 0 ? "stat-ring__tick stat-ring__tick--major" : "stat-ring__tick"}
                  />
                ))}
              </g>
              <circle className="stat-ring__track" cx={C} cy={C} r={RING} />
              <circle className="stat-ring__inner" cx={C} cy={C} r={62} />
              {segments.map((segment, index) => (
                <path
                  key={segment.source}
                  className="stat-ring__slice"
                  d={segment.d}
                  stroke={segment.color}
                  pathLength={1}
                  style={{ animationDelay: `${120 + index * 70}ms` }}
                />
              ))}
            </svg>
            <div className="stat-ring__center">
              <span className="stat-ring__total">{formatPoints(post.total)}</span>
              <span className="cr-label">Points</span>
            </div>
          </div>
          <ul className="stat-legend">
            {segments.map((segment) => (
              <li key={segment.source} className="stat-legend__row" style={{ "--slice": segment.color } as CSSProperties}>
                <span className="stat-legend__dot" />
                <span className="stat-legend__label">{POINTS_SOURCE_LABELS[segment.source] ?? segment.source}</span>
                <span className="stat-legend__share">{Math.round(segment.share * 100)}%</span>
                <span className="stat-legend__pts">+{formatPoints(segment.points)}</span>
              </li>
            ))}
          </ul>
        </div>

        {entries.length > 0 && (
          <div className="stat-lately">
            <p className="cr-label">Lately</p>
            <ul>
              {entries.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <b>+{formatPoints(entry.amount)}</b>
                  <span>{POINTS_SOURCE_LABELS[entry.source] ?? entry.source}</span>
                  <time>{relativeTime(entry.at)}</time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </HudDialog>
  );
}
