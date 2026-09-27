/**
 * The game: every post earns points, points make levels, levels make ranks
 * (Bronze Recruit to Legendary General), and everyone on a plan is on one
 * leaderboard. These tools read the same numbers as the Points tab.
 */

import {
  BADGES,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  POINTS_SOURCE_LABELS,
  POINTS_START_AT,
  RANK_TIERS,
  RANK_TITLES,
  rankForLevel,
} from "@posterract/contract";
import { loadLeaderboard, loadPointsDashboard, loadPostPoints } from "../../points.js";
import { ToolError, UUID } from "../context.js";

const MEDAL_ORDER = ["first_transmission", "streak_7", "record", "breakout", "streak_30", "club_100k", "streak_100", "streak_365"];
const round2 = (value) => Math.round(value * 100) / 100;

/** A rule's metric in words, e.g. "48,200 views" or "96.5 hours watched". */
function measured(source, value) {
  if (value === undefined || value === null) return undefined;
  const count = Math.round(value).toLocaleString("en-US");
  switch (source) {
    case "views": return `${count} views`;
    case "likes": return `${count} likes`;
    case "comments": return `${count} comments`;
    case "shares": return `${count} shares`;
    case "saves": return `${count} saves`;
    case "watch": return `${value} hours watched`;
    case "retention": return `${Math.round(value)}% watched on average`;
    case "record":
    case "breakout": return `${count} views`;
    default: return undefined;
  }
}

const describeParts = (parts) =>
  parts.map((part) => ({
    rule: POINTS_SOURCE_LABELS[part.source] ?? part.source,
    points: part.points,
    ...(measured(part.source, part.value) ? { for: measured(part.source, part.value) } : {}),
  }));

function tipsFor(dashboard) {
  const tips = [];
  const { streak, level, nextLevelAt, totalPoints } = dashboard;
  if (streak.current === 0) {
    tips.push("Start a streak: post a new video today. Seven days in a row earns +10, thirty earns +1,000.");
  } else if (streak.next) {
    const left = streak.next.days - streak.current;
    tips.push(`Keep the ${streak.current}-day streak alive with a new video every day: ${left} more ${left === 1 ? "day" : "days"} to the ${streak.next.days}-day bonus (+${streak.next.points.toLocaleString("en-US")}).`);
  }
  if (nextLevelAt !== null) {
    tips.push(`${round2(nextLevelAt - totalPoints).toLocaleString("en-US")} more points to ${rankForLevel(level + 1).label}.`);
  }
  tips.push("Views and watch time earn the most: a point per 1,000 views on Instagram and Facebook (2,000 on Threads), and a point per hour watched.");
  tips.push("Beat your best views for a Personal Record (+10), or get three times your usual views for a Breakout (+5).");
  return tips;
}

export const getMyRank = {
  name: "get_my_rank",
  title: "Get my rank and points",
  description:
    "The user's Posterract game status: rank (e.g. Gold Captain), level (1 to 100), points this week, this month and " +
    "all time, posting streak, medals, and what to do next to rank up. Use it after posting, or when the user asks how they're doing.",
  scopes: ["points:read", "posts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context) {
    const dashboard = await loadPointsDashboard(context.postgres, context.workspaceId);
    const rank = rankForLevel(dashboard.level);
    const nextTierIndex = rank.tierIndex + 1;
    const nextTierLevel = nextTierIndex * RANK_TITLES.length + 1;
    const have = new Set(dashboard.badges);
    return {
      rank: rank.label,
      level: dashboard.level,
      tier: `${RANK_TIERS[rank.tierIndex].label} (tier ${rank.tierIndex + 1} of ${RANK_TIERS.length})`,
      points: { total: dashboard.totalPoints, this_week: dashboard.weekPoints, this_month: dashboard.monthPoints },
      next_level:
        dashboard.nextLevelAt === null
          ? `Level ${MAX_LEVEL}, the top rank.`
          : {
              level: dashboard.level + 1,
              rank: rankForLevel(dashboard.level + 1).label,
              points_to_go: round2(dashboard.nextLevelAt - dashboard.totalPoints),
            },
      ...(nextTierIndex < RANK_TIERS.length
        ? {
            next_tier: {
              tier: RANK_TIERS[nextTierIndex].label,
              at_level: nextTierLevel,
              points_to_go: round2(LEVEL_THRESHOLDS[nextTierLevel - 1] - dashboard.totalPoints),
            },
          }
        : {}),
      streak: {
        days: dashboard.streak.current,
        best: dashboard.streak.best,
        ...(dashboard.streak.next
          ? { next_bonus: { at_days: dashboard.streak.next.days, points: dashboard.streak.next.points } }
          : {}),
      },
      medals: {
        earned: MEDAL_ORDER.filter((id) => have.has(id)).map((id) => BADGES[id]),
        locked: MEDAL_ORDER.filter((id) => !have.has(id)).map((id) => BADGES[id]),
      },
      ...(dashboard.topPosts[0]
        ? { best_post: { title: dashboard.topPosts[0].title, platform: dashboard.topPosts[0].provider, points: dashboard.topPosts[0].total } }
        : {}),
      how_to_rank_up: tipsFor(dashboard),
      note: "A post earns 1 point per platform the moment it's live; views, engagement and watch time add points twice a day as stats come in.",
    };
  },
};

export const getLeaderboard = {
  name: "get_leaderboard",
  title: "Get the leaderboard",
  description: "The Posterract leaderboard: the top creators by points this week, this month or all time, and where the user stands.",
  scopes: ["points:read", "posts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: ["week", "month", "all"], description: "Defaults to week." },
      top: { type: "integer", minimum: 1, maximum: 50, description: "How many of the top creators to list. Defaults to 10." },
    },
    additionalProperties: false,
  },
  async run(context, args) {
    const period = args.period ?? "week";
    const board = await loadLeaderboard(context.postgres, context.workspaceId, period, 100);
    const row = (entry) => ({ position: entry.position, name: entry.name, rank: entry.rank.label, level: entry.level, points: entry.points });
    return {
      period: { week: "this week", month: "this month", all: "all time" }[period],
      creators_ranked: board.total,
      you: board.me
        ? { ...row(board.me), top_percent: Math.max(1, Math.ceil((board.me.position / Math.max(1, board.total)) * 100)) }
        : "Not on the leaderboard: it lists everyone with an active Posterract plan.",
      top: board.entries.slice(0, args.top ?? 10).map(row),
    };
  },
};

export const getPostPoints = {
  name: "get_post_points",
  title: "See what a post earned",
  description:
    "Explains the points a post earned, rule by rule (views, likes, comments, shares, saves, watch time, bonuses), on each " +
    "platform. Without a post_id, shows the user's highest-scoring posts.",
  scopes: ["points:read", "posts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: "object",
    properties: { post_id: { type: "string", pattern: UUID, description: "From create_post or list_schedule." } },
    additionalProperties: false,
  },
  async run(context, args) {
    if (args.post_id) {
      const post = await loadPostPoints(context.postgres, context.workspaceId, args.post_id);
      if (!post) throw new ToolError("Couldn't find that post. Use list_schedule to find its id.");
      return {
        title: post.title,
        total_points: post.total,
        platforms: post.platforms.map((platform) => ({
          platform: platform.provider,
          status: platform.status,
          points: platform.total,
          breakdown: describeParts(platform.parts),
          ...(platform.url ? { url: platform.url } : {}),
        })),
        note:
          post.total === 0
            ? `No points yet. Posts earn once they're live on Instagram, Facebook or Threads (published on or after ${new Date(POINTS_START_AT).toISOString().slice(0, 10)}), and stats add points twice a day.`
            : "Points only go up: they're recalculated twice a day as the post's stats grow.",
      };
    }
    const dashboard = await loadPointsDashboard(context.postgres, context.workspaceId);
    return {
      top_posts: dashboard.topPosts.slice(0, 5).map((post) => ({
        title: post.title,
        platform: post.provider,
        points: post.total,
        breakdown: describeParts(post.parts),
        ...(post.url ? { url: post.url } : {}),
      })),
    };
  },
};

export const GAME_TOOLS = [getMyRank, getLeaderboard, getPostPoints];
