import { useMemo } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Button, EmptyState, Panel, PlatformRune, StatusBadge } from "@posterract/hyperkit";
import { PLATFORM_CAPABILITIES, PLATFORM_ORDER, type PlatformId } from "@posterract/contract";
import { useProjections, useTransmissions } from "@/engine/useEngine";
import { formatWhen } from "@/lib/fmt";

export const Route = createFileRoute("/_app/echoes")({
  component: Analytics,
});

const DAY = 86400_000;

/**
 * Analytics — what came back from the six dimensions. Computed live from
 * your actual posting history. (Platform view/like counts arrive when the
 * real platform APIs connect — these are your posting analytics.)
 */
function Analytics() {
  const transmissions = useTransmissions();
  const projections = useProjections();

  const stats = useMemo(() => {
    const liveProjections = projections.filter((p) => p.status === "live");
    const finished = projections.filter((p) =>
      ["live", "failed", "blocked", "needs_reauth"].includes(p.status),
    );
    const byPlatform = PLATFORM_ORDER.map((platform) => ({
      platform,
      count: liveProjections.filter((p) => p.provider === platform).length,
    }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 14 }, (_, i) => {
      const start = today.getTime() - (13 - i) * DAY;
      return {
        start,
        label: new Date(start).toLocaleDateString([], { day: "numeric" }),
        count: transmissions.filter(
          (t) =>
            (t.status === "live" || t.status === "partial") &&
            (t.scheduledFor ?? 0) >= start &&
            (t.scheduledFor ?? 0) < start + DAY,
        ).length,
      };
    });

    return {
      postedTotal: transmissions.filter((t) => t.status === "live" || t.status === "partial").length,
      scheduled: transmissions.filter((t) => t.status === "scheduled").length,
      successRate: finished.length ? Math.round((liveProjections.length / finished.length) * 100) : null,
      liveProjectionCount: liveProjections.length,
      byPlatform,
      days,
      recent: transmissions
        .filter((t) => t.status === "live" || t.status === "partial")
        .sort((a, b) => (b.scheduledFor ?? 0) - (a.scheduledFor ?? 0))
        .slice(0, 6),
    };
  }, [transmissions, projections]);

  if (stats.postedTotal === 0 && stats.scheduled === 0) {
    return (
      <Panel className="min-h-[60vh]">
        <EmptyState
          title="Listening for echoes…"
          detail="Analytics build from your posting history. Publish your first post and the signals start returning."
          action={
            <Link to="/compose">
              <Button variant="primary">New Post</Button>
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Posts published" value={String(stats.postedTotal)} />
        <Kpi label="Platform deliveries" value={String(stats.liveProjectionCount)} />
        <Kpi label="Delivery success" value={stats.successRate === null ? "—" : `${stats.successRate}%`} good={stats.successRate !== null && stats.successRate >= 90} />
        <Kpi label="Scheduled ahead" value={String(stats.scheduled)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Posts per day — area chart */}
        <Panel kicker="Posting rhythm" title="Posts per day · last 14 days" brackets>
          <RhythmChart days={stats.days} />
        </Panel>

        {/* Per-platform deliveries — bars */}
        <Panel kicker="Reach per dimension" title="Deliveries by platform" brackets>
          <div className="space-y-2.5 pt-1">
            {stats.byPlatform.map(({ platform, count }) => {
              const max = Math.max(1, ...stats.byPlatform.map((b) => b.count));
              const caps = PLATFORM_CAPABILITIES[platform];
              return (
                <div key={platform} className="flex items-center gap-3">
                  <span className="flex w-24 flex-none items-center gap-1.5 text-[12px] text-starlight-dim">
                    <PlatformRune platform={platform} size={13} />
                    {caps.label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-void-3">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${(count / max) * 100}%`,
                        background: `linear-gradient(90deg, color-mix(in srgb, ${caps.accent} 55%, transparent), ${caps.accent})`,
                        boxShadow: count > 0 ? `0 0 10px color-mix(in srgb, ${caps.accent} 40%, transparent)` : undefined,
                      }}
                    />
                  </div>
                  <span className="telemetry w-6 flex-none text-right text-[12px] text-starlight">{count}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Recent posts */}
      <Panel kicker="Recent" title="Latest published posts" brackets>
        {stats.recent.length === 0 ? (
          <p className="text-[12.5px] text-starlight-faint">Nothing published yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--glass-border)]">
            {stats.recent.map((t) => {
              const projs = projections.filter((p) => p.transmissionId === t.id);
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-starlight">{t.title}</span>
                  <span className="telemetry flex-none text-[11px] text-starlight-faint">{formatWhen(t.scheduledFor)}</span>
                  <StatusBadge status={t.status} size="sm" />
                  <span className="flex flex-none items-center gap-1.5">
                    {projs
                      .filter((p) => p.platformPostUrl)
                      .map((p) => (
                        <a
                          key={p.id}
                          href={p.platformPostUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={`View on ${PLATFORM_CAPABILITIES[p.provider].label}`}
                          className="text-starlight-dim transition-colors hover:text-neon"
                        >
                          <PlatformRune platform={p.provider as PlatformId} size={13} />
                        </a>
                      ))}
                    <ExternalLink size={11} className="text-starlight-faint" />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-center text-[11px] text-starlight-faint">
        Views, likes, and comments per post arrive when the real platform APIs connect (cloud phase).
      </p>
    </div>
  );
}

function Kpi({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <Panel className="!p-4">
      <p className={`telemetry text-[24px] font-medium ${good ? "text-auroral" : "text-starlight"}`}>{value}</p>
      <p className="kicker mt-1 !text-[9.5px]">{label}</p>
    </Panel>
  );
}

/** Area chart of posts/day, pure SVG, neon gradient under the line. */
function RhythmChart({ days }: { days: Array<{ label: string; count: number }> }) {
  const W = 520;
  const H = 150;
  const PAD = 18;
  const max = Math.max(2, ...days.map((d) => d.count));
  const x = (i: number) => PAD + (i / (days.length - 1)) * (W - PAD * 2);
  const y = (c: number) => H - PAD - (c / max) * (H - PAD * 2);
  const points = days.map((d, i) => `${x(i)},${y(d.count)}`).join(" ");
  const area = `${PAD},${H - PAD} ${points} ${W - PAD},${H - PAD}`;

  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="w-full" role="img" aria-label="Posts per day, last 14 days">
      <defs>
        <linearGradient id="rhythm-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(101,255,154,0.35)" />
          <stop offset="1" stopColor="rgba(101,255,154,0)" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD} x2={W - PAD} y1={H - PAD - f * (H - PAD * 2)} y2={H - PAD - f * (H - PAD * 2)} stroke="rgba(155,255,197,0.08)" />
      ))}
      <polygon points={area} fill="url(#rhythm-fill)" />
      <polyline points={points} fill="none" stroke="#65ff9a" strokeWidth="1.75" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 6px rgba(101,255,154,0.45))" }} />
      {days.map((d, i) => (
        <g key={i}>
          {d.count > 0 && <circle cx={x(i)} cy={y(d.count)} r="2.5" fill="#65ff9a" />}
          <text x={x(i)} y={H + 8} textAnchor="middle" fontSize="8.5" fill="var(--starlight-faint)" fontFamily="var(--font-mono)">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
