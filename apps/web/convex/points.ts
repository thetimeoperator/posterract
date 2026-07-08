/**
 * Resonance — the points engine. Awards land in an append-only ledger and
 * roll up into userStats; rank is derived (rankFor) and never stored beyond
 * events. Awarding is idempotent per (refId, source), so publish retries and
 * re-dispatches can never double-award.
 */
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getOwnedWorkspace } from "./lib";
import {
  BADGES,
  RP_HEXACAST_BONUS,
  RP_PER_LIVE_PROJECTION,
  RP_POSTING_DAILY_CAP,
  RP_STREAK_DAILY_CAP,
  RP_STREAK_PER_DAY,
  rankFor,
} from "@posterract/contract";

const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week containing ts. */
function startOfWeek(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000;
}

async function getOrCreateStats(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
): Promise<Doc<"userStats">> {
  const existing = await ctx.db
    .query("userStats")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  if (existing) return existing;
  const id = await ctx.db.insert("userStats", {
    workspaceId,
    lifetimeRP: 0,
    weekRP: 0,
    weekStartAt: startOfWeek(Date.now()),
    streakDays: 0,
    badges: [],
  });
  return (await ctx.db.get(id))!;
}

/**
 * Award posting RP for a projection that just went live. Called from
 * publishHelpers.patchProjection (the single status choke point), so every
 * connector — simulated or real — earns points with no per-connector code.
 */
export async function awardPointsForLiveProjection(
  ctx: MutationCtx,
  projectionId: Id<"projections">,
): Promise<void> {
  // Idempotency: one "post" award per projection, ever.
  const already = await ctx.db
    .query("pointsLedger")
    .withIndex("by_ref", (q) => q.eq("refId", projectionId as string).eq("source", "post"))
    .first();
  if (already) return;

  const projection = await ctx.db.get(projectionId);
  if (!projection || projection.status !== "live") return;
  const workspaceId = projection.workspaceId;
  const stats = await getOrCreateStats(ctx, workspaceId);
  const now = Date.now();
  const today = dayOf(now);

  // Daily posting cap — sum today's posting-sourced RP.
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const todays = await ctx.db
    .query("pointsLedger")
    .withIndex("by_workspace_at", (q) => q.eq("workspaceId", workspaceId).gte("at", dayStart.getTime()))
    .collect();
  const postingSoFar = todays
    .filter((e) => e.source === "post" || e.source === "bonus" || e.source === "streak")
    .reduce((sum, e) => sum + e.amount, 0);
  let capLeft = Math.max(0, RP_POSTING_DAILY_CAP - postingSoFar);

  type Entry = { source: Doc<"pointsLedger">["source"]; amount: number; refId?: string; note?: string };
  const entries: Entry[] = [];
  const pushCapped = (e: Entry) => {
    const amount = Math.min(e.amount, capLeft);
    if (amount <= 0) return;
    capLeft -= amount;
    entries.push({ ...e, amount });
  };

  pushCapped({
    source: "post",
    amount: RP_PER_LIVE_PROJECTION,
    refId: projectionId as string,
    note: `${projection.provider} projection live`,
  });

  // Streak — first posting award of a new day bumps it.
  let { streakDays, lastPostDay } = stats;
  if (lastPostDay !== today) {
    streakDays = lastPostDay === dayOf(now - 86400_000) ? streakDays + 1 : 1;
    lastPostDay = today;
    pushCapped({
      source: "streak",
      amount: Math.min(RP_STREAK_PER_DAY * streakDays, RP_STREAK_DAILY_CAP),
      refId: `${workspaceId}:${today}`,
      note: `Streak — day ${streakDays}`,
    });
  }

  // Hexacast — all six platforms live on this transmission (once per transmission).
  const siblings = await ctx.db
    .query("projections")
    .withIndex("by_transmission", (q) => q.eq("transmissionId", projection.transmissionId))
    .collect();
  const liveProviders = new Set(siblings.filter((p) => p.status === "live").map((p) => p.provider));
  if (liveProviders.size === 6) {
    const hexRef = projection.transmissionId as string;
    const hexDone = await ctx.db
      .query("pointsLedger")
      .withIndex("by_ref", (q) => q.eq("refId", hexRef).eq("source", "bonus"))
      .first();
    if (!hexDone) {
      pushCapped({ source: "bonus", amount: RP_HEXACAST_BONUS, refId: hexRef, note: "Hexacast — all six live" });
    }
  }

  // Milestone badges — one-time, outside the daily cap.
  const badges = new Set(stats.badges);
  const newBadges: string[] = [];
  const grant = (key: string, rp: number) => {
    if (badges.has(key)) return;
    badges.add(key);
    newBadges.push(key);
    entries.push({ source: "milestone", amount: rp, refId: `${workspaceId}:${key}`, note: BADGES[key] ?? key });
  };
  grant("first_transmission", 25);
  if (liveProviders.size === 6) grant("hexacast", 50);
  if (streakDays >= 7) grant("streak_7", 50);
  if (streakDays >= 30) grant("streak_30", 150);
  if (streakDays >= 100) grant("streak_100", 500);

  // Week rollover happens lazily here (and via the weekly cron).
  const curWeek = startOfWeek(now);
  const weekRP = stats.weekStartAt < curWeek ? 0 : stats.weekRP;

  const total = entries.reduce((sum, e) => sum + e.amount, 0);
  for (const e of entries) await ctx.db.insert("pointsLedger", { workspaceId, ...e, at: now });

  const beforeRank = rankFor(stats.lifetimeRP);
  const afterRank = rankFor(stats.lifetimeRP + total);
  await ctx.db.patch(stats._id, {
    lifetimeRP: stats.lifetimeRP + total,
    weekRP: weekRP + total,
    weekStartAt: curWeek,
    streakDays,
    lastPostDay,
    badges: [...badges],
  });

  if (total > 0) {
    await ctx.db.insert("events", {
      workspaceId,
      transmissionId: projection.transmissionId,
      projectionId: projection._id,
      type: "points.awarded",
      message: `+${total} Resonance`,
      at: now,
    });
  }
  if (afterRank.id !== beforeRank.id) {
    await ctx.db.insert("events", {
      workspaceId,
      type: "points.rankup",
      message: `Rank ascended — ${afterRank.label}`,
      at: now,
    });
  }
  for (const key of newBadges) {
    await ctx.db.insert("events", {
      workspaceId,
      type: "points.badge",
      message: `Badge unlocked — ${BADGES[key] ?? key}`,
      at: now,
    });
  }
}

/** The signed-in user's Resonance summary (null when logged out). */
export const getMyPoints = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await getOwnedWorkspace(ctx);
    if (!workspace) return null;
    const stats = await ctx.db
      .query("userStats")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .first();
    const recent = await ctx.db
      .query("pointsLedger")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(30);
    const now = Date.now();
    // A streak is only alive if the last posting day was today or yesterday.
    const streakAlive =
      !!stats?.lastPostDay && (stats.lastPostDay === dayOf(now) || stats.lastPostDay === dayOf(now - 86400_000));
    return {
      lifetimeRP: stats?.lifetimeRP ?? 0,
      weekRP: stats && stats.weekStartAt >= startOfWeek(now) ? stats.weekRP : 0,
      streakDays: streakAlive ? (stats?.streakDays ?? 0) : 0,
      badges: stats?.badges ?? [],
      recent: recent.map((e) => ({
        id: e._id as string,
        source: e.source,
        amount: e.amount,
        note: e.note,
        at: e.at,
      })),
    };
  },
});

/** Weekly cron: roll weekRP for the new week (Monday 00:05 UTC). */
export const resetWeekly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const week = startOfWeek(Date.now());
    const all = await ctx.db.query("userStats").collect();
    for (const s of all) {
      if (s.weekStartAt < week) await ctx.db.patch(s._id, { weekRP: 0, weekStartAt: week });
    }
  },
});
