import { Link, createFileRoute } from "@tanstack/react-router";
import clsx from "clsx";
import { Flame, Radio, Sparkles, TrendingUp, Zap } from "lucide-react";
import { Button, EmptyState, OrbitRing, Panel, ProgressBeam, Telemetry } from "@posterract/hyperkit";
import type { PointsSource } from "@posterract/contract";
import { BADGES, RANKS, nextRank, rankFor } from "@posterract/contract";
import { usePoints, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/points")({
  component: Points,
});

const SOURCE_LABEL: Record<PointsSource, string> = {
  post: "Post live",
  bonus: "Bonus",
  streak: "Streak",
  milestone: "Milestone",
  views: "Views",
  likes: "Likes",
  comments: "Comments",
};

/**
 * Resonance — the points chamber. Rank ring, charge toward the next rank,
 * streak + weekly telemetry, badges, and the recent RP feed.
 */
function Points() {
  const points = usePoints();
  const transmissions = useTransmissions();
  const lifetimeRP = points?.lifetimeRP ?? 0;
  const weekRP = points?.weekRP ?? 0;
  const streakDays = points?.streakDays ?? 0;
  const badges = points?.badges ?? [];
  const recent = points?.recent ?? [];

  // Track record — the operator's posting history at a glance.
  const weekStartTs = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime() - ((d.getDay() + 6) % 7) * 86400_000;
  })();
  const postedThisWeek = transmissions.filter(
    (t) => (t.status === "live" || t.status === "partial") && (t.scheduledFor ?? 0) >= weekStartTs,
  ).length;
  const liveCount = transmissions.filter((t) => t.status === "live" || t.status === "partial").length;
  const scheduledCount = transmissions.filter((t) => t.status === "scheduled").length;

  const rank = rankFor(lifetimeRP);
  const next = nextRank(lifetimeRP);
  const spanStart = rank.minRP;
  const spanEnd = next?.minRP ?? rank.minRP;
  const progress = next ? (lifetimeRP - spanStart) / Math.max(1, spanEnd - spanStart) : 1;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-[12.5px] text-starlight-dim">
        Resonance charges the device. Every projection that goes live earns it — and once portals report back,
        the views your posts pull in earn more.
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        {/* ── Left: the rank core ── */}
        <div className="flex flex-col gap-4">
          <Panel kicker="Current charge" brackets className="flex flex-col items-center py-6">
            <OrbitRing value={progress} size={150} stroke={5} label="Progress to next rank">
              <span className="flex flex-col items-center">
                <span className="telemetry text-[26px] font-semibold text-starlight">{lifetimeRP.toLocaleString()}</span>
                <span className="kicker !text-[9px]">Resonance</span>
              </span>
            </OrbitRing>
            <p className="mt-4 font-display text-[16px] font-semibold text-neon">{rank.label}</p>
            {next ? (
              <p className="mt-1 text-[11.5px] text-starlight-faint">
                {(next.minRP - lifetimeRP).toLocaleString()} RP to {next.label}
              </p>
            ) : (
              <p className="mt-1 text-[11.5px] text-starlight-faint">The device is fully lit.</p>
            )}
            <div className="mt-3 w-full px-2">
              <ProgressBeam value={progress} label="Progress to next rank" />
            </div>
          </Panel>

          <Panel kicker="Signal telemetry">
            <Telemetry
              rows={[
                { k: "this week", v: `${weekRP.toLocaleString()} RP`, tone: "good" },
                { k: "streak", v: streakDays > 0 ? `${streakDays} day${streakDays > 1 ? "s" : ""}` : "—", tone: streakDays >= 3 ? "good" : undefined },
                { k: "badges", v: String(badges.length) },
              ]}
            />
          </Panel>

          <Panel kicker="Track record">
            <Telemetry
              rows={[
                { k: "posted this week", v: String(postedThisWeek) },
                { k: "published all-time", v: String(liveCount), tone: "good" },
                { k: "scheduled ahead", v: String(scheduledCount) },
              ]}
            />
          </Panel>

          <Panel kicker="Badges" title="Milestones">
            {badges.length === 0 ? (
              <p className="text-[12px] text-starlight-faint">No badges yet — your first live post unlocks one.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {badges.map((key) => (
                  <li
                    key={key}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[rgba(101,255,154,0.3)] bg-[rgba(101,255,154,0.07)] px-2 py-1 text-[11px] text-neon"
                  >
                    <Sparkles size={11} />
                    {BADGES[key] ?? key}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* ── Right: how to earn + ladder + feed ── */}
        <div className="flex flex-col gap-4">
          <Panel kicker="Earning" title="How Resonance is earned" brackets>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { icon: Radio, k: "Transmit", v: "+10 per platform a post goes live on, +30 when all six land." },
                { icon: Flame, k: "Streak", v: "Post daily — each consecutive day earns a growing bonus." },
                { icon: TrendingUp, k: "Echoes", v: "Views, likes and comments convert to RP as platforms report back." },
              ].map(({ icon: Icon, k, v }) => (
                <li key={k} className="glass rounded-[var(--radius-card)] p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-medium text-starlight">
                    <Icon size={13} className="text-neon" /> {k}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-snug text-starlight-faint">{v}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel kicker="Ascension" title="Ranks">
            <ul className="space-y-1">
              {RANKS.map((r) => {
                const reached = lifetimeRP >= r.minRP;
                const current = r.id === rank.id;
                return (
                  <li
                    key={r.id}
                    className={clsx(
                      "flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[12px]",
                      current && "border border-[rgba(101,255,154,0.35)] bg-[rgba(101,255,154,0.06)]",
                    )}
                  >
                    <span className={clsx(reached ? "text-starlight" : "text-starlight-faint", current && "text-neon")}>
                      {r.label}
                      {current && <span className="kicker ml-2 !text-[8px] !text-neon">· you</span>}
                    </span>
                    <span className="telemetry text-[10.5px] text-starlight-faint">
                      {r.minRP.toLocaleString()} RP
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel kicker="Ledger" title="Recent Resonance" brackets>
            {recent.length === 0 ? (
              <EmptyState
                title="No Resonance yet."
                detail="Transmit something — the first live post starts the charge."
                action={
                  <Link to="/compose">
                    <Button variant="primary" size="sm" icon={<Zap size={13} />}>
                      Start a post
                    </Button>
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {recent.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-2.5 text-[12px]">
                    <span className="telemetry w-14 flex-none text-right text-[12px] font-medium text-neon">
                      +{e.amount}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-starlight-dim">
                      {e.note ?? SOURCE_LABEL[e.source]}
                    </span>
                    <span className="telemetry flex-none text-[9px] text-starlight-faint">
                      {new Date(e.at).toLocaleDateString([], { month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
