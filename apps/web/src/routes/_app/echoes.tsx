import { useMemo, useState, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Clock3,
  Eye,
  Heart,
  MessageCircle,
  RadioTower,
  Share2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button, EmptyState, Panel, PlatformRune, Segmented } from "@posterract/hyperkit";
import {
  PLATFORM_CAPABILITIES,
  PLATFORM_ORDER,
  type AnalyticsRangeDays,
  type PlatformAnalyticsDTO,
  type PlatformId,
} from "@posterract/contract";
import { useAnalyticsDashboard, useProjections, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/echoes")({ component: Analytics });

type PlatformFilter = "all" | "instagram" | "tiktok" | "youtube" | "facebook" | "threads";
const FILTERS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "All signals" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "threads", label: "Threads" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
];
const RANGES: Array<{ value: `${AnalyticsRangeDays}`; label: string }> = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

function Analytics() {
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [rangeValue, setRangeValue] = useState<`${AnalyticsRangeDays}`>("30");
  const rangeDays = Number(rangeValue) as AnalyticsRangeDays;
  const dashboard = useAnalyticsDashboard(rangeDays);
  const transmissions = useTransmissions();
  const projections = useProjections();

  const selected = useMemo(
    () => (dashboard?.platforms ?? []).filter((row) => platform === "all" || row.provider === platform),
    [dashboard, platform],
  );
  const totals = useMemo(() => summarize(selected), [selected]);
  const facebookPageViews =
    platform === "facebook" && selected.length === 1 ? selected[0].pageViews : undefined;
  const topPosts = useMemo(
    () => selected.flatMap((row) => row.posts).sort((a, b) => b.views - a.views).slice(0, 8),
    [selected],
  );
  const delivery = useMemo(() => {
    const live = projections.filter((row) => row.status === "live");
    const finished = projections.filter((row) =>
      ["live", "failed", "blocked", "needs_reauth"].includes(row.status),
    );
    return {
      published: transmissions.filter((row) => row.status === "live" || row.status === "partial").length,
      scheduled: transmissions.filter((row) => row.status === "scheduled").length,
      successRate: finished.length ? Math.round((live.length / finished.length) * 100) : undefined,
      byPlatform: PLATFORM_ORDER.map((provider) => ({
        provider,
        count: live.filter((row) => row.provider === provider).length,
      })),
    };
  }, [projections, transmissions]);

  const anyConnected = (dashboard?.platforms ?? []).some((row) => row.connected);
  const isEmpty = dashboard && !anyConnected && delivery.published === 0 && delivery.scheduled === 0;
  if (isEmpty) {
    return (
      <Panel className="min-h-[60vh]" brackets>
        <EmptyState
          title="Listening for echoes…"
          detail="Connect a platform, then publish your first transmission. Audience and performance signals will resolve here."
          action={<Link to="/portals"><Button variant="primary">Connect a platform</Button></Link>}
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4" data-testid="analytics-dashboard">
      <section className="glass relative overflow-hidden px-5 py-5 sm:px-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(circle at 16% 0%, rgba(101,255,154,.13), transparent 34%), radial-gradient(circle at 88% 8%, rgba(124,247,255,.08), transparent 26%)" }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2 text-neon">
              <RadioTower size={14} />
              <span className="kicker !text-neon">Signal intelligence</span>
            </div>
            <h1 className="font-display text-[25px] font-semibold tracking-[-0.025em] text-starlight sm:text-[30px]">
              What returned from the transmission.
            </h1>
            <p className="mt-1.5 max-w-xl text-[12.5px] text-starlight-dim">
              One performance surface for every connected dimension—without flattening the signals that make each platform different.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <PlatformSelector value={platform} onChange={setPlatform} />
            <Segmented
              aria-label="Analytics date range"
              options={RANGES}
              value={rangeValue}
              onChange={setRangeValue}
            />
          </div>
        </div>
      </section>

      {selected.some((row) => row.connected && !row.ready) && (
        <ScopeNotice platforms={selected.filter((row) => row.connected && !row.ready)} />
      )}

      <div
        className={`grid grid-cols-2 gap-3 ${facebookPageViews === undefined ? "xl:grid-cols-5" : "xl:grid-cols-6"}`}
      >
        <MetricCard icon={<Users size={15} />} label={totals.audienceLabel} value={compact(totals.audience)} delta={totals.audienceDelta} />
        {facebookPageViews !== undefined && (
          <MetricCard icon={<Eye size={15} />} label="Page views" value={compact(facebookPageViews)} />
        )}
        <MetricCard
          icon={<Eye size={15} />}
          label={facebookPageViews === undefined ? "Views" : "Post views"}
          value={compact(totals.views)}
        />
        <MetricCard icon={<TrendingUp size={15} />} label="Engagement" value={`${totals.engagementRate.toFixed(1)}%`} />
        <MetricCard icon={<Sparkles size={15} />} label="Published" value={String(totals.publishedPosts)} />
        <MetricCard
          icon={<Clock3 size={15} />}
          label={totals.watchMinutes > 0 ? "Watch time" : "Interactions"}
          value={totals.watchMinutes > 0 ? formatMinutes(totals.watchMinutes) : compact(totals.interactions)}
          className="col-span-2 xl:col-span-1"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.85fr)]">
        <Panel
          kicker="Resonance curve"
          title={`Views · last ${rangeDays} days`}
          actions={<ChartLegend platforms={selected} />}
          brackets
          className="min-w-0"
        >
          <SignalChart platforms={selected} rangeDays={rangeDays} />
        </Panel>
        <Panel kicker="Engagement mix" title="How the audience responded" brackets>
          <EngagementMix totals={totals} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <Panel kicker="Strongest signals" title="Top-performing transmissions" brackets>
          <TopPosts posts={topPosts} />
        </Panel>
        <Panel kicker="Portal telemetry" title="Connected analytics" brackets>
          <div className="space-y-3">
            {(dashboard?.platforms ?? []).map((row) => <PlatformStatus key={row.provider} platform={row} />)}
          </div>
        </Panel>
      </div>

      <Panel kicker="Publishing telemetry" title="Delivery health" brackets>
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="grid grid-cols-3 gap-2">
            <SmallReadout label="Posts" value={delivery.published} />
            <SmallReadout label="Success" value={delivery.successRate === undefined ? "—" : `${delivery.successRate}%`} />
            <SmallReadout label="Queued" value={delivery.scheduled} />
          </div>
          <DeliveryBars rows={delivery.byPlatform} />
        </div>
      </Panel>
    </div>
  );
}

function PlatformSelector({ value, onChange }: { value: PlatformFilter; onChange: (value: PlatformFilter) => void }) {
  return (
    <div className="inline-flex rounded-[10px] border border-[var(--glass-border)] bg-void-2 p-1" role="radiogroup" aria-label="Platform filter">
      {FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex h-8 items-center gap-1.5 rounded-[7px] px-3 font-display text-[11.5px] transition ${active ? "border border-[rgba(101,255,154,.36)] bg-[rgba(101,255,154,.08)] text-starlight shadow-glow-neon-sm" : "border border-transparent text-starlight-dim hover:text-starlight"}`}
          >
            {option.value !== "all" && <PlatformRune platform={option.value} size={12} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ScopeNotice({ platforms }: { platforms: PlatformAnalyticsDTO[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-solar/30 bg-[rgba(255,204,102,.06)] px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <RadioTower size={17} className="mt-0.5 flex-none text-solar" />
        <div>
          <p className="font-display text-[12.5px] font-semibold text-starlight">Analytics permission required</p>
          <p className="mt-0.5 text-[11px] text-starlight-dim">
            Reconnect {platforms.map((row) => PLATFORM_CAPABILITIES[row.provider].label).join(" and ")} once to authorize the new read-only analytics scopes.
          </p>
        </div>
      </div>
      <Link to="/portals"><Button variant="secondary" size="sm">Open portals</Button></Link>
    </div>
  );
}

function MetricCard({ icon, label, value, delta, className = "" }: { icon: ReactNode; label: string; value: string; delta?: number; className?: string }) {
  return (
    <Panel className={`!overflow-hidden !p-0 ${className}`}>
      <div className="relative p-4">
        <div className="mb-3 flex items-center justify-between text-starlight-faint">
          {icon}<span className="kicker !text-[8px]">Live signal</span>
        </div>
        <p className="telemetry text-[23px] font-medium leading-none text-starlight">{value}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="kicker !text-[9px]">{label}</p>
          {delta !== undefined && delta !== 0 && <span className={`telemetry text-[9px] ${delta > 0 ? "text-neon" : "text-redshift"}`}>{delta > 0 ? "+" : ""}{delta.toLocaleString()}</span>}
        </div>
      </div>
    </Panel>
  );
}

function SignalChart({ platforms, rangeDays }: { platforms: PlatformAnalyticsDTO[]; rangeDays: number }) {
  const W = 780;
  const H = 252;
  const P = { left: 42, right: 14, top: 15, bottom: 30 };
  const dates = dateRange(rangeDays);
  const series = platforms.map((platform) => {
    const map = new Map(platform.daily.map((row) => [row.date, row.views]));
    return { platform: platform.provider, values: dates.map((date) => map.get(date) ?? 0) };
  });
  const max = Math.max(10, ...series.flatMap((row) => row.values));
  const x = (index: number) => P.left + (index / Math.max(1, dates.length - 1)) * (W - P.left - P.right);
  const y = (value: number) => H - P.bottom - (value / max) * (H - P.top - P.bottom);
  const hasData = series.some((row) => row.values.some((value) => value > 0));
  if (!hasData) {
    return <div className="flex h-[250px] items-center justify-center text-center text-[12px] text-starlight-faint">Signals begin resolving after the first analytics refresh.</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" role="img" aria-label="Daily views by platform">
      <defs>
        {series.map((row) => {
          const color = PLATFORM_CAPABILITIES[row.platform].accent;
          return <linearGradient key={row.platform} id={`echo-${row.platform}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient>;
        })}
      </defs>
      {[0, .25, .5, .75, 1].map((fraction) => {
        const value = Math.round(max * fraction);
        return <g key={fraction}><line x1={P.left} x2={W - P.right} y1={y(value)} y2={y(value)} stroke="rgba(155,255,197,.085)" /><text x={P.left - 9} y={y(value) + 3} textAnchor="end" fontSize="8" fill="var(--starlight-faint)" fontFamily="var(--font-mono)">{compact(value)}</text></g>;
      })}
      {series.map((row) => {
        const color = PLATFORM_CAPABILITIES[row.platform].accent;
        const points = row.values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
        const area = `${P.left},${H - P.bottom} ${points} ${W - P.right},${H - P.bottom}`;
        return <g key={row.platform}><polygon points={area} fill={`url(#echo-${row.platform})`} /><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color}70)` }} /></g>;
      })}
      {dates.map((date, index) => {
        const stride = rangeDays <= 7 ? 1 : rangeDays <= 30 ? 5 : 15;
        if (index % stride !== 0 && index !== dates.length - 1) return null;
        return <text key={date} x={x(index)} y={H - 8} textAnchor="middle" fontSize="8" fill="var(--starlight-faint)" fontFamily="var(--font-mono)">{new Date(`${date}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</text>;
      })}
    </svg>
  );
}

function ChartLegend({ platforms }: { platforms: PlatformAnalyticsDTO[] }) {
  return <div className="flex items-center gap-3">{platforms.map((row) => <span key={row.provider} className="flex items-center gap-1.5 text-[9px] text-starlight-dim"><span className="h-1.5 w-4 rounded-full" style={{ background: PLATFORM_CAPABILITIES[row.provider].accent, boxShadow: `0 0 8px ${PLATFORM_CAPABILITIES[row.provider].accent}` }} />{PLATFORM_CAPABILITIES[row.provider].label}</span>)}</div>;
}

function EngagementMix({ totals }: { totals: ReturnType<typeof summarize> }) {
  const rows = [
    { label: "Likes", value: totals.likes, icon: <Heart size={13} />, color: "var(--neon)" },
    { label: "Comments", value: totals.comments, icon: <MessageCircle size={13} />, color: "var(--ice)" },
    { label: "Shares", value: totals.shares, icon: <Share2 size={13} />, color: "var(--pure)" },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-5 pt-1">
      {rows.map((row) => <div key={row.label}><div className="mb-1.5 flex items-center gap-2 text-[11px] text-starlight-dim"><span style={{ color: row.color }}>{row.icon}</span><span>{row.label}</span><span className="telemetry ml-auto text-starlight">{compact(row.value)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-void-3"><div className="h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: row.color, boxShadow: `0 0 10px ${row.color}` }} /></div></div>)}
      <div className="border-t border-[var(--glass-border)] pt-3"><p className="kicker !text-[8px]">Total response</p><p className="telemetry mt-1 text-[20px] text-starlight">{compact(totals.interactions)} <span className="font-body text-[10px] text-starlight-faint">interactions</span></p></div>
    </div>
  );
}

function TopPosts({ posts }: { posts: PlatformAnalyticsDTO["posts"] }) {
  if (!posts.length) return <p className="py-8 text-center text-[12px] text-starlight-faint">Published-post metrics will resolve here.</p>;
  return <div className="divide-y divide-[var(--glass-border)]">{posts.map((post, index) => <div key={post.projectionId} className="grid grid-cols-[22px_minmax(0,1fr)_64px_52px_24px] items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="telemetry text-[10px] text-starlight-faint">{String(index + 1).padStart(2, "0")}</span><div className="flex min-w-0 items-center gap-2"><PlatformRune platform={post.provider} size={14} /><div className="min-w-0"><p className="truncate text-[12px] text-starlight">{post.title}</p><p className="telemetry mt-0.5 text-[8.5px] text-starlight-faint">{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "Published"}</p></div></div><div className="text-right"><p className="telemetry text-[11px] text-starlight">{compact(post.views)}</p><p className="kicker !text-[7px]">Views</p></div><div className="text-right"><p className="telemetry text-[11px] text-starlight">{compact(post.likes + post.comments + post.shares)}</p><p className="kicker !text-[7px]">Acts</p></div>{post.platformPostUrl ? <a href={post.platformPostUrl} target="_blank" rel="noreferrer" aria-label={`Open ${post.title}`} className="text-starlight-faint transition hover:text-neon"><ArrowUpRight size={14} /></a> : <span />}</div>)}</div>;
}

function PlatformStatus({ platform }: { platform: PlatformAnalyticsDTO }) {
  const caps = PLATFORM_CAPABILITIES[platform.provider];
  const status = !platform.connected ? "Not connected" : platform.ready ? "Receiving" : "Reconnect";
  return <div className="rounded-[12px] border border-[var(--glass-border)] bg-void-2/45 p-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-void-3"><PlatformRune platform={platform.provider} size={15} /></span><div className="min-w-0 flex-1"><p className="font-display text-[12px] font-medium text-starlight">{caps.label}</p><p className="truncate text-[9.5px] text-starlight-faint">{platform.handle ?? "Awaiting portal"}</p></div><span className={`telemetry text-[8px] uppercase ${platform.ready ? "text-neon" : platform.connected ? "text-solar" : "text-starlight-faint"}`}>{status}</span></div><div className="mt-3 flex items-end justify-between border-t border-[var(--glass-border)] pt-2.5"><div><p className="telemetry text-[16px] text-starlight">{platform.audience === undefined ? "—" : compact(platform.audience)}</p><p className="kicker !text-[7px]">{platform.audienceLabel}</p></div><p className="telemetry text-[8.5px] text-starlight-faint">{platform.lastSyncedAt ? `Synced ${relativeTime(platform.lastSyncedAt)}` : "No signal yet"}</p></div></div>;
}

function DeliveryBars({ rows }: { rows: Array<{ provider: PlatformId; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 sm:grid-cols-3">{rows.map((row) => { const caps = PLATFORM_CAPABILITIES[row.provider]; return <div key={row.provider} className="flex items-center gap-2"><PlatformRune platform={row.provider} size={12} /><span className="w-14 text-[9.5px] text-starlight-dim">{caps.label}</span><div className="h-1 flex-1 rounded-full bg-void-3"><div className="h-full rounded-full" style={{ width: `${(row.count / max) * 100}%`, background: caps.accent }} /></div><span className="telemetry w-4 text-right text-[9px] text-starlight-faint">{row.count}</span></div>; })}</div>;
}

function SmallReadout({ label, value }: { label: string; value: number | string }) {
  return <div><p className="telemetry text-[17px] text-starlight">{value}</p><p className="kicker mt-1 !text-[7px]">{label}</p></div>;
}

function summarize(platforms: PlatformAnalyticsDTO[]) {
  const result = platforms.reduce((total, row) => ({
    audience: total.audience + (row.audience ?? 0), audienceDelta: total.audienceDelta + row.audienceDelta,
    views: total.views + row.views, likes: total.likes + row.likes, comments: total.comments + row.comments,
    shares: total.shares + row.shares, watchMinutes: total.watchMinutes + (row.watchMinutes ?? 0), publishedPosts: total.publishedPosts + row.publishedPosts,
  }), { audience: 0, audienceDelta: 0, views: 0, likes: 0, comments: 0, shares: 0, watchMinutes: 0, publishedPosts: 0 });
  const interactions = result.likes + result.comments + result.shares;
  return { ...result, interactions, engagementRate: result.views ? (interactions / result.views) * 100 : 0, audienceLabel: platforms.length === 1 ? platforms[0].audienceLabel : "Total audience" };
}

function dateRange(days: number) { const today = new Date(); today.setHours(0, 0, 0, 0); return Array.from({ length: days }, (_, index) => new Date(today.getTime() - (days - index - 1) * 86400_000).toISOString().slice(0, 10)); }
function compact(value: number) { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value); }
function formatMinutes(minutes: number) { return minutes >= 60 ? `${compact(minutes / 60)}h` : `${Math.round(minutes)}m`; }
function relativeTime(timestamp: number) { const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000)); return minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`; }
