import {
  PLATFORM_CAPABILITIES,
  RANK_TIERS,
  RANK_TITLES,
  rankForLevel,
  type LeaderboardDTO,
  type PointsDashboardDTO,
  type PointsPlatform,
  type PostPointsDTO,
} from "@posterract/contract";

/**
 * What one rank card says, worked out from the Points data. There are two:
 * the creator's rank card (their rank and level, then their points and
 * views), and a card for one video (the creator's rank, then what the video
 * earned and its numbers). Both always show the current numbers. The drawing
 * code only lays this out.
 */

export type CardKind = "rank" | "video";

export type CardStat = {
  label: string;
  value: number;
  /** How the number is written: points keep two decimals, compact is 48.2K. */
  format: "points" | "whole" | "compact";
  prefix?: string;
  suffix?: string;
  /** Drawn in the accent: a gain. */
  up?: boolean;
  /** Takes a whole row of the grid. */
  wide?: boolean;
};

export type CardModel = {
  id: string;
  kind: CardKind;
  /** The creator's rank: the emblem, the metal and the name on the card. */
  level: number;
  /** XP from this level to the next, 0 to 1. */
  progress: number;
  /** Points still to go to the next level; undefined at the top. */
  toNext?: number;
  /** The line over the rank name, or over a video's title (PERSONAL RECORD, BREAKOUT…). */
  kicker: string;
  /** Top right, opposite the level: the creator's place this week, or the video's date. */
  corner: { value: string; label: string };
  /** The number the card is about: all-time points, or what the video earned. */
  hero: CardStat;
  /** The readouts under it. */
  stats: CardStat[];
  /** The video a video card is about. */
  post?: { key: string; title: string; provider: PointsPlatform; platformLabel: string };
  player: { name: string; handle?: string };
  /** What the caption says when the card is posted. */
  caption: string;
};

export type Player = { name: string; handle?: string };

const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);

const dateCorner = (at: number) => ({
  value: new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase(),
  label: new Date(at).toLocaleDateString("en-US", { year: "numeric" }),
});

export function tierOf(level: number) {
  const rank = rankForLevel(level);
  return { rank, tier: RANK_TIERS[rank.tierIndex]!, title: RANK_TITLES[rank.titleIndex]! };
}

function levelProgress(dashboard: PointsDashboardDTO) {
  const { levelFloor, nextLevelAt, totalPoints } = dashboard;
  if (nextLevelAt === null) return { progress: 1, toNext: undefined };
  const span = Math.max(1, nextLevelAt - levelFloor);
  return {
    progress: Math.min(1, Math.max(0, (totalPoints - levelFloor) / span)),
    toNext: Math.max(0, Math.round((nextLevelAt - totalPoints) * 100) / 100),
  };
}

/**
 * The creator's rank card: their rank, then their points (all time, this
 * month, this week) and the views their posts have earned points for.
 */
export function rankCard(
  dashboard: PointsDashboardDTO,
  week: LeaderboardDTO | undefined,
  allTime: LeaderboardDTO | undefined,
  player: Player,
): CardModel {
  const { rank } = tierOf(dashboard.level);
  const place = week?.me;
  const views = allTime?.me?.views ?? 0;
  return {
    id: "rank",
    kind: "rank",
    level: dashboard.level,
    ...levelProgress(dashboard),
    kicker: "Current rank",
    // The place this week, with the share of the board it beats: "#10", "this week · top 25%".
    corner: place
      ? {
          value: `#${place.position}`,
          label: week && week.total > 1 ? `This week · top ${Math.max(1, Math.ceil((place.position / week.total) * 100))}%` : "This week",
        }
      : dateCorner(Date.now()),
    hero: { label: "Total points · all time", value: dashboard.totalPoints, format: "points" },
    stats: [
      { label: "This month", value: dashboard.monthPoints, format: "points", prefix: "+", up: true },
      { label: "This week", value: dashboard.weekPoints, format: "points", prefix: "+", up: true },
      { label: "Total views", value: views, format: "compact", wide: true },
    ],
    player,
    caption: `${rank.label}, level ${dashboard.level} on Posterract: ${Math.round(dashboard.totalPoints).toLocaleString("en-US")} points and ${compact(views)} views from my posts so far.`,
  };
}

/** A video's card: the creator's rank, then what the video earned, its views, likes, comments and shares. */
export function videoCard(post: PostPointsDTO, dashboard: PointsDashboardDTO, player: Player): CardModel {
  const platformLabel = PLATFORM_CAPABILITIES[post.provider].label;
  const metrics = post.metrics;
  const sources = new Set(post.parts.map((part) => part.source));
  const kicker = sources.has("record") ? "Personal record" : sources.has("breakout") ? "Breakout" : `Posted on ${platformLabel}`;
  const views = metrics?.views ?? 0;
  return {
    id: `video:${post.projectionId}`,
    kind: "video",
    level: dashboard.level,
    ...levelProgress(dashboard),
    kicker,
    corner: post.publishedAt ? dateCorner(post.publishedAt) : dateCorner(Date.now()),
    hero: { label: "Points earned", value: post.total, format: "points", prefix: "+", up: true },
    stats: [
      { label: "Views", value: views, format: "compact" },
      { label: "Likes", value: metrics?.likes ?? 0, format: "compact" },
      { label: "Comments", value: metrics?.comments ?? 0, format: "compact" },
      { label: "Shares", value: metrics?.shares ?? 0, format: "compact" },
    ],
    post: { key: post.projectionId, title: post.title, provider: post.provider, platformLabel },
    player,
    caption: `${compact(views)} views and ${post.total.toLocaleString("en-US", { maximumFractionDigits: 2 })} points on ${platformLabel}. Scored on Posterract.`,
  };
}
