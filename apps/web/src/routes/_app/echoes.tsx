import { useMemo, useState, type CSSProperties } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Heart,
  MessageCircle,
  RadioTower,
  Share2,
} from "lucide-react";
import { Button, EmptyState, Panel, PlatformBrandMark, Segmented } from "@posterract/hyperkit";
import {
  ANALYTICS_PLATFORM_IDS,
  PLATFORM_CAPABILITIES,
  type AnalyticsPlatformId,
  type AnalyticsPostDTO,
  type AnalyticsRangeDays,
  type PlatformAnalyticsDTO,
  type PlatformId,
} from "@posterract/contract";
import { useAnalyticsDashboard, useProjections, useTransmissions } from "@/engine/useEngine";

export const Route = createFileRoute("/_app/echoes")({ component: Analytics });

type PlatformFilter = "all" | AnalyticsPlatformId;
type ChartMetric = "views" | "interactions" | "growth";
type SignalMetric =
  | "audience"
  | "views"
  | "interactions"
  | "engagementRate"
  | "likes"
  | "comments"
  | "shares"
  | "reach"
  | "saves"
  | "watchMinutes"
  | "growth";

type SignalMetricModel = {
  id: SignalMetric;
  label: string;
  value: number | undefined;
  previous: number | undefined;
  series: Array<number | null>;
  scope: string;
};

const FILTERS: Array<{ value: PlatformFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "threads", label: "Threads" },
];

const RANGES: Array<{ value: `${AnalyticsRangeDays}`; label: string }> = [
  { value: "total", label: "Total" },
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
];

const CHART_METRICS: Array<{ value: ChartMetric; label: string }> = [
  { value: "views", label: "Views" },
  { value: "interactions", label: "Interactions" },
  { value: "growth", label: "Growth" },
];

const SIGNAL_METRICS: Record<PlatformFilter, SignalMetric[]> = {
  all: ["audience", "views", "interactions", "engagementRate", "likes", "growth"],
  instagram: ["audience", "reach", "views", "likes", "saves", "engagementRate"],
  tiktok: ["audience", "views", "likes", "comments", "shares", "engagementRate"],
  facebook: ["audience", "views", "interactions", "likes", "watchMinutes", "engagementRate"],
  threads: ["audience", "views", "likes", "comments", "shares", "engagementRate"],
};

const SIGNAL_TONES = [
  { primary: "101,255,154", secondary: "124,247,255" },
  { primary: "37,244,238", secondary: "35,124,255" },
  { primary: "255,0,105", secondary: "168,85,247" },
  { primary: "255,151,64", secondary: "255,58,148" },
  { primary: "139,92,246", secondary: "34,211,238" },
  { primary: "255,214,102", secondary: "101,255,154" },
] as const;

const ANALYTICS_STYLES = `
  .analytics-signal-tile {
    position: relative;
    isolation: isolate;
    min-width: 0;
    min-height: 205px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 17px;
    background:
      radial-gradient(circle at 5% 0%, rgba(var(--signal-a), .14), transparent 36%) padding-box,
      radial-gradient(ellipse at 50% 112%, rgba(var(--signal-a), .11), transparent 60%) padding-box,
      linear-gradient(155deg, rgba(8, 13, 14, .96), rgba(2, 5, 7, .985)) padding-box,
      conic-gradient(
        from 215deg,
        rgba(var(--signal-b), .76),
        rgba(var(--signal-a), .94) 19%,
        rgba(235,255,245,.18) 38%,
        rgba(var(--signal-b), .12) 56%,
        rgba(var(--signal-a), .38) 78%,
        rgba(var(--signal-b), .7)
      ) border-box;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.045),
      inset 0 0 24px rgba(var(--signal-a), .025),
      0 14px 32px rgba(0,0,0,.22),
      0 0 18px rgba(var(--signal-a), .035);
    transition: transform 180ms ease, box-shadow 180ms ease;
  }
  .analytics-signal-tile::before {
    content: "";
    position: absolute;
    z-index: 2;
    top: 0;
    left: -36%;
    width: 48%;
    height: 1px;
    pointer-events: none;
    border-radius: 999px;
    background: linear-gradient(90deg, transparent, rgba(var(--signal-a), .72), rgba(255,255,255,.94), rgba(var(--signal-b), .5), transparent);
    filter: drop-shadow(0 0 7px rgba(var(--signal-a), .32));
    animation: analytics-signal-frame 5.8s ease-in-out infinite;
    animation-delay: calc(var(--signal-i) * -.55s);
  }
  .analytics-signal-tile::after {
    content: "";
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at 0 0, rgba(var(--signal-a), .13), transparent 36%),
      linear-gradient(115deg, rgba(var(--signal-a), .025), transparent 45%, rgba(var(--signal-b), .02));
  }
  .analytics-signal-tile:hover {
    transform: translateY(-2px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 18px 38px rgba(0,0,0,.28), 0 0 22px rgba(var(--signal-a), .04);
  }
  .analytics-signal-value {
    color: rgb(var(--signal-a));
    text-shadow: 0 0 16px rgba(var(--signal-a), .16);
  }
  .analytics-signal-graph {
    filter: drop-shadow(0 0 2px rgba(var(--signal-a), .22));
  }
  .analytics-signal-line-glow {
    opacity: .12;
    filter: blur(.65px);
  }
  .analytics-signal-line:not(.analytics-signal-line-glow) {
    filter: drop-shadow(0 0 1.5px rgba(var(--signal-a), .82)) drop-shadow(0 0 4px rgba(var(--signal-a), .22));
  }
  .analytics-signal-line {
    animation: analytics-line-arrive 520ms cubic-bezier(.22,.7,.2,1) both;
  }
  .analytics-signal-area {
    animation: analytics-area-arrive 620ms ease-out both;
  }
  .analytics-platform-card {
    position: relative;
    min-width: 0;
    overflow: hidden;
    border: 1px solid rgba(173, 255, 205, .14);
    border-radius: 20px;
    background:
      radial-gradient(circle at 8% 0%, color-mix(in srgb, var(--platform-accent) 13%, transparent), transparent 43%),
      linear-gradient(145deg, rgba(10, 23, 21, .78), rgba(3, 10, 12, .87));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.025), 0 14px 36px rgba(0,0,0,.18);
  }
  .analytics-platform-card__rail {
    height: 2px;
    margin: 0 16px;
    background: linear-gradient(90deg, transparent, var(--platform-accent) 18%, var(--platform-secondary) 82%, transparent);
    box-shadow: 0 0 16px color-mix(in srgb, var(--platform-accent) 28%, transparent);
  }
  .analytics-platform-summary {
    background: linear-gradient(110deg, color-mix(in srgb, var(--platform-accent) 10%, transparent), rgba(255,255,255,.018));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--platform-accent) 13%, transparent);
  }
  .analytics-platform-metric {
    min-width: 0;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(231,255,240,.045), rgba(255,255,255,.012));
    box-shadow: inset 0 0 0 1px rgba(221,255,233,.07);
  }
  .analytics-panel > header {
    padding: 20px 22px 0;
  }
  .analytics-panel > header .kicker {
    font-size: 10.5px;
  }
  .analytics-panel > header h2 {
    margin-top: 4px;
    font-size: 18px;
    letter-spacing: -.012em;
  }
  @keyframes analytics-signal-frame {
    0%, 18% { opacity: 0; transform: translateX(0); }
    42% { opacity: .95; }
    72%, 100% { opacity: 0; transform: translateX(285%); }
  }
  @keyframes analytics-line-arrive {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes analytics-area-arrive {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .analytics-signal-tile::before { animation: none; }
    .analytics-signal-tile:hover { transform: none; }
    .analytics-signal-line, .analytics-signal-area { animation: none; }
  }
`;

function Analytics() {
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [rangeValue, setRangeValue] = useState<`${AnalyticsRangeDays}`>("total");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("views");
  const rangeDays: AnalyticsRangeDays = rangeValue === "total"
    ? "total"
    : Number(rangeValue) as AnalyticsRangeDays;
  const dashboard = useAnalyticsDashboard(rangeDays);
  const transmissions = useTransmissions();
  const projections = useProjections();

  const selected = useMemo(
    () =>
      (dashboard?.platforms ?? []).filter(
        (row) =>
          (ANALYTICS_PLATFORM_IDS as readonly string[]).includes(row.provider) &&
          (platform === "all" || row.provider === platform),
      ),
    [dashboard, platform],
  );
  const totals = useMemo(() => summarize(selected), [selected]);
  const signalMetrics = useMemo(
    () => buildSignalMetrics(selected, platform, rangeDays),
    [selected, platform, rangeDays],
  );
  const lastSyncedAt = useMemo(() => {
    const timestamps = selected
      .map((row) => row.lastSyncedAt)
      .filter((value): value is number => value !== undefined);
    return timestamps.length ? Math.max(...timestamps) : undefined;
  }, [selected]);
  const topPosts = useMemo(
    () =>
      selected
        .flatMap((row) => row.posts)
        .sort((left, right) => scorePost(right) - scorePost(left))
        .slice(0, 10),
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
      byPlatform: ANALYTICS_PLATFORM_IDS.map((provider) => ({
        provider,
        count: live.filter((row) => row.provider === provider).length,
      })),
    };
  }, [projections, transmissions]);

  // Do not render real-looking zeroes while the selected range is still
  // loading. That previously made connected accounts appear disconnected
  // during the initial Total request (and after a transient failed request).
  if (!dashboard) {
    return (
      <Panel className="min-h-[60vh]">
        <EmptyState
          title="Loading account analytics"
          detail="Retrieving connected accounts and their available totals."
        />
      </Panel>
    );
  }

  const anyConnected = dashboard.platforms.some(
    (row) =>
      (ANALYTICS_PLATFORM_IDS as readonly string[]).includes(row.provider) && row.connected,
  );
  const isEmpty = dashboard && !anyConnected && delivery.published === 0 && delivery.scheduled === 0;
  if (isEmpty) {
    return (
      <Panel className="min-h-[60vh]">
        <EmptyState
          title="No analytics yet"
          detail="Connect TikTok, Instagram, Facebook, or Threads, then publish your first post. Performance data will appear here after the first analytics sync."
          action={
            <Link to="/portals">
              <Button variant="primary">Connect a platform</Button>
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4" data-testid="analytics-dashboard">
      <style>{ANALYTICS_STYLES}</style>
      <section className="glass relative overflow-hidden px-5 py-5 sm:px-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              "radial-gradient(circle at 14% 0%, rgba(101,255,154,.12), transparent 31%), radial-gradient(circle at 90% 10%, rgba(124,247,255,.08), transparent 28%)",
          }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-neon">
              <BarChart3 size={14} />
              <span className="kicker !text-neon">Cross-platform performance</span>
            </div>
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.03em] text-starlight sm:text-[34px]">
              Analytics
            </h1>
            <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-starlight-dim">
              TikTok, Instagram, Facebook, and Threads performance in one dashboard.
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

      <section aria-labelledby="performance-pulse-title">
        <div className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker !text-[10.5px]">Performance pulse</p>
            <h2 id="performance-pulse-title" className="mt-1 font-display text-[25px] font-semibold tracking-[-0.025em] text-starlight">
              The signals shaping your growth
            </h2>
          </div>
          <p className="text-[11.5px] text-starlight-faint">
            {lastSyncedAt ? `Latest account sync ${relativeTime(lastSyncedAt)}` : "Trend baselines begin after your first analytics sync"}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Performance overview">
          {signalMetrics.map((metric, index) => (
            <MetricCard key={metric.id} tone={index} metric={metric} rangeDays={rangeDays} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.75fr)]">
        <Panel
          kicker="Performance over time"
          title={`${chartLabel(chartMetric)} · ${rangeDescription(rangeDays)}`}
          actions={
            <MiniTabs options={CHART_METRICS} value={chartMetric} onChange={setChartMetric} />
          }
          className="analytics-panel min-w-0"
        >
          <SignalChart platforms={selected} rangeDays={rangeDays} metric={chartMetric} />
          <ChartLegend platforms={selected} />
        </Panel>
        <Panel kicker="Platform contribution" title="Where performance came from" className="analytics-panel">
          <PlatformContribution platforms={selected} totalViews={totals.views} />
        </Panel>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4 px-1">
          <div>
            <p className="kicker !text-[10.5px]">Platform intelligence</p>
            <h2 className="mt-1 font-display text-[25px] font-semibold tracking-[-0.025em] text-starlight">
              Metrics that matter on each network
            </h2>
          </div>
          <p className="hidden text-right text-[11.5px] text-starlight-faint sm:block">
            Account totals and selected-period results are labeled separately.
          </p>
        </div>
        <div className={`grid gap-4 ${selected.length === 1 ? "max-w-[920px] grid-cols-1" : "md:grid-cols-2"}`}>
          {selected.map((row) => (
            <PlatformIntelligence key={row.provider} platform={row} rangeDays={rangeDays} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.55fr)]">
        <Panel kicker="Content leaderboard" title="Top posts by impact" className="analytics-panel">
          <TopPosts posts={topPosts} />
        </Panel>
        <Panel kicker="Audience response" title="Interaction mix" className="analytics-panel">
          <EngagementMix totals={totals} platform={platform} />
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
        <Panel kicker="Data coverage" title="Available analytics" className="analytics-panel">
          <Coverage platforms={selected} />
        </Panel>
        <Panel kicker="Publishing telemetry" title="Delivery health" className="analytics-panel">
          <div className="grid grid-cols-3 gap-3">
            <SmallReadout label="Published" value={delivery.published} />
            <SmallReadout label="Success" value={delivery.successRate === undefined ? "—" : `${delivery.successRate}%`} />
            <SmallReadout label="Queued" value={delivery.scheduled} />
          </div>
          <div className="mt-5 border-t border-[var(--glass-border)] pt-4">
            <DeliveryBars rows={delivery.byPlatform} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function PlatformSelector({ value, onChange }: { value: PlatformFilter; onChange: (value: PlatformFilter) => void }) {
  return (
    <div className="flex max-w-full items-center overflow-x-auto rounded-[10px] bg-void-2/80 p-1" role="radiogroup" aria-label="Platform filter">
      {FILTERS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`flex h-9 flex-none items-center gap-2 rounded-[7px] px-3 font-display text-[12px] transition-colors ${
              active
                ? "bg-[rgba(101,255,154,.1)] text-starlight"
                : "text-starlight-faint hover:text-starlight"
            }`}
          >
            {option.value !== "all" && <PlatformBrandMark platform={option.value} height={14} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MiniTabs<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-[8px] bg-void-2/75 p-1" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-[6px] px-2.5 py-1.5 font-display text-[10.5px] transition-colors ${
            value === option.value ? "bg-[rgba(124,247,255,.09)] text-ice" : "text-starlight-faint hover:text-starlight"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ScopeNotice({ platforms }: { platforms: PlatformAnalyticsDTO[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-[rgba(255,204,102,.065)] px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <RadioTower size={17} className="mt-0.5 flex-none text-solar" />
        <div>
          <p className="font-display text-[14px] font-semibold text-starlight">Analytics access needs attention</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-starlight-dim">
            Reconnect {platforms.map((row) => PLATFORM_CAPABILITIES[row.provider].label).join(" and ")} to grant the approved read-only analytics permissions.
          </p>
        </div>
      </div>
      <Link to="/portals">
        <Button variant="secondary" size="sm">Open accounts</Button>
      </Link>
    </div>
  );
}

type SignalStyle = CSSProperties & {
  "--signal-a": string;
  "--signal-b": string;
  "--signal-i": number;
};

function MetricCard({
  tone,
  metric,
  rangeDays,
}: {
  tone: number;
  metric: SignalMetricModel;
  rangeDays: AnalyticsRangeDays;
}) {
  const colors = SIGNAL_TONES[tone % SIGNAL_TONES.length];
  const style = {
    "--signal-a": colors.primary,
    "--signal-b": colors.secondary,
    "--signal-i": tone,
  } as SignalStyle;
  const comparison = comparisonPercent(metric.value, metric.previous);
  const comparisonLabel = rangeDays === "total"
    ? "All time"
    : comparison === undefined
      ? "Baseline"
      : `${comparison >= 0 ? "+" : ""}${comparison.toFixed(Math.abs(comparison) >= 10 ? 0 : 1)}%`;
  return (
    <article
      className="analytics-signal-tile"
      style={style}
      data-signal-metric={metric.id}
      aria-label={rangeDays === "total"
        ? `${metric.label}: ${formatSignalValue(metric.id, metric.value)}. All available history.`
        : `${metric.label}: ${formatSignalValue(metric.id, metric.value)}. ${comparisonLabel} compared with the previous ${rangeDays} days.`}
    >
      <div className="relative z-[1] flex h-full min-h-[205px] flex-col px-[16px] pb-[13px] pt-[15px]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-2 w-2 flex-none rounded-full bg-[rgb(var(--signal-a))] shadow-[0_0_10px_rgba(var(--signal-a),.45)]" />
            <p className="truncate font-display text-[14px] font-semibold tracking-[-0.015em] text-starlight">{metric.label}</p>
          </div>
          <div className="flex-none text-right">
            <p className="analytics-signal-value telemetry text-[32px] font-medium leading-none tracking-[-0.055em]">
              {formatSignalValue(metric.id, metric.value)}
            </p>
            <div className={`mt-1.5 flex items-center justify-end gap-1.5 ${comparison === undefined ? "text-starlight-faint" : comparison >= 0 ? "text-neon" : "text-redshift"}`}>
              {comparison !== undefined && <ArrowUpRight size={12} strokeWidth={2.5} className={comparison < 0 ? "rotate-90" : ""} />}
              <p className="telemetry text-[11.5px] font-medium">{comparisonLabel}</p>
            </div>
          </div>
        </div>
        <MetricSparkline metric={metric} tone={tone} />
      </div>
    </article>
  );
}

function MetricSparkline({ metric, tone }: { metric: SignalMetricModel; tone: number }) {
  const width = 480;
  const height = 98;
  const insetX = -2;
  const insetY = 6;
  const values = metric.series;
  const observedValues = values.filter((value): value is number => value !== null);
  const rawMinimum = observedValues.length ? Math.min(...observedValues) : 0;
  const rawMaximum = observedValues.length ? Math.max(...observedValues) : 0;
  const rawSpan = rawMaximum - rawMinimum;
  const visualPadding = rawSpan === 0 ? Math.max(Math.abs(rawMaximum) * .08, 1) : rawSpan * .12;
  const minimum = rawMinimum - visualPadding;
  const maximum = rawMaximum + visualPadding;
  const span = Math.max(1, maximum - minimum);
  const points = observedValues.map((value, index) => ({
    x: insetX + (index / Math.max(1, observedValues.length - 1)) * (width - insetX * 2),
    y: height - insetY - ((value - minimum) / span) * (height - insetY * 2),
  }));
  const gradientId = `signal-area-${metric.id}-${tone}`;
  const hasHistory = observedValues.length >= 2;
  const line = smoothPath(points);
  const first = points[0];
  const last = points.at(-1);
  const area = first && last ? `${line} L ${last.x} ${height + 2} L ${first.x} ${height + 2} Z` : "";
  return (
    <div className="relative mt-auto h-[98px] overflow-hidden" aria-hidden>
        {hasHistory ? (
        <svg
          data-testid="signal-sparkline"
          data-observed-points={observedValues.length}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="analytics-signal-graph block h-full w-full overflow-hidden"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={`rgb(${SIGNAL_TONES[tone % SIGNAL_TONES.length].primary})`} stopOpacity=".34" />
              <stop offset=".6" stopColor={`rgb(${SIGNAL_TONES[tone % SIGNAL_TONES.length].primary})`} stopOpacity=".1" />
              <stop offset="1" stopColor={`rgb(${SIGNAL_TONES[tone % SIGNAL_TONES.length].secondary})`} stopOpacity=".005" />
            </linearGradient>
          </defs>
          <path className="analytics-signal-area" d={area} fill={`url(#${gradientId})`} stroke="none" />
          <path
            className="analytics-signal-line analytics-signal-line-glow"
            d={line}
            fill="none"
            stroke={`rgb(${SIGNAL_TONES[tone % SIGNAL_TONES.length].primary})`}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            data-signal-line
            className="analytics-signal-line"
            d={line}
            fill="none"
            stroke={`rgb(${SIGNAL_TONES[tone % SIGNAL_TONES.length].primary})`}
            strokeWidth=".8"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        ) : null}
        {!hasHistory && (
          <span className="absolute inset-0 flex items-center justify-center font-display text-[11px] uppercase tracking-[.12em] text-starlight-faint">
            Waiting for daily trend data
          </span>
        )}
    </div>
  );
}

function SignalChart({ platforms, rangeDays, metric }: { platforms: PlatformAnalyticsDTO[]; rangeDays: AnalyticsRangeDays; metric: ChartMetric }) {
  const width = 820;
  const height = 270;
  const padding = { left: 45, right: 15, top: 16, bottom: 31 };
  const dates = analyticsDates(platforms, rangeDays);
  const series = platforms.map((platform) => {
    const map = new Map(platform.daily.map((row) => [row.date, dailyMetric(row, metric)]));
    const values = dates.map((date) => map.get(date) ?? 0);
    const observed = metric === "views"
      ? platform.provider === "facebook" ? platform.postViews ?? platform.views : platform.views
      : metric === "interactions"
        ? platform.likes + platform.comments + platform.shares
        : platform.audienceDelta;
    if (platform.connected && observed !== 0 && !values.some((value) => value !== 0) && values.length) {
      values[values.length - 1] = observed;
    }
    return { platform: platform.provider, values };
  });
  const min = Math.min(0, ...series.flatMap((row) => row.values));
  const max = Math.max(10, ...series.flatMap((row) => row.values));
  const span = Math.max(1, max - min);
  const x = (index: number) => padding.left + (index / Math.max(1, dates.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => height - padding.bottom - ((value - min) / span) * (height - padding.top - padding.bottom);
  const hasData = series.some((row) => row.values.some((value) => value !== 0));
  if (!hasData) {
    return (
      <div className="flex h-[300px] items-center justify-center text-center text-[13.5px] text-starlight-faint">
        {platforms.some((row) => row.connected)
          ? `Waiting for the first ${chartLabel(metric).toLowerCase()} sync.`
          : "Connect a platform to begin receiving analytics."}
      </div>
    );
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label={`Daily ${chartLabel(metric).toLowerCase()} by platform`}>
      <defs>
        {series.map((row) => {
          const color = PLATFORM_CAPABILITIES[row.platform].accent;
          return (
            <linearGradient key={row.platform} id={`analytics-${row.platform}-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity=".25" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          );
        })}
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const value = min + span * fraction;
        return (
          <g key={fraction}>
            <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} stroke="rgba(155,255,197,.075)" />
            <text x={padding.left - 9} y={y(value) + 3} textAnchor="end" fontSize="9.5" fill="var(--starlight-faint)" fontFamily="var(--font-mono)">
              {compact(Math.round(value))}
            </text>
          </g>
        );
      })}
      {series.map((row) => {
        const color = PLATFORM_CAPABILITIES[row.platform].accent;
        const points = row.values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
        const area = `${padding.left},${y(0)} ${points} ${width - padding.right},${y(0)}`;
        return (
          <g key={row.platform}>
            <polygon points={area} fill={`url(#analytics-${row.platform}-${metric})`} />
            <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}
      {dates.map((date, index) => {
        const stride = rangeDays === "total"
          ? Math.max(1, Math.ceil(dates.length / 6))
          : rangeDays <= 7 ? 1 : rangeDays <= 30 ? 5 : 15;
        if (index % stride !== 0 && index !== dates.length - 1) return null;
        return (
          <text key={date} x={x(index)} y={height - 8} textAnchor="middle" fontSize="9.5" fill="var(--starlight-faint)" fontFamily="var(--font-mono)">
            {new Date(`${date}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
          </text>
        );
      })}
    </svg>
  );
}

function ChartLegend({ platforms }: { platforms: PlatformAnalyticsDTO[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--glass-border)] pt-3">
      {platforms.map((row) => (
        <span key={row.provider} className="flex items-center gap-2 text-[11px] text-starlight-dim">
          <span className="h-1.5 w-4 rounded-full" style={{ background: PLATFORM_CAPABILITIES[row.provider].accent }} />
          {PLATFORM_CAPABILITIES[row.provider].label}
          <span className={`telemetry text-[8.5px] uppercase ${row.ready ? "text-neon" : "text-starlight-faint"}`}>
            {row.ready ? "Live" : row.connected ? "Limited" : "Offline"}
          </span>
        </span>
      ))}
    </div>
  );
}

function PlatformContribution({ platforms, totalViews }: { platforms: PlatformAnalyticsDTO[]; totalViews: number }) {
  const max = Math.max(1, ...platforms.map((row) => row.views));
  return (
    <div className="space-y-4">
      {platforms.map((row) => {
        const caps = PLATFORM_CAPABILITIES[row.provider];
        const share = totalViews ? (row.views / totalViews) * 100 : 0;
        return (
          <div key={row.provider}>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-7 w-8 items-center justify-center"><PlatformBrandMark platform={row.provider} height={20} /></span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-[13px] text-starlight">{caps.label}</p>
                <p className="truncate text-[10px] text-starlight-faint">{row.handle ?? "Not connected"}</p>
              </div>
              <div className="text-right">
                <p className="telemetry text-[13px] text-starlight">{compact(row.views)}</p>
                <p className="telemetry text-[9px] text-starlight-faint">{share.toFixed(0)}%</p>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-void-3">
              <div className="h-full rounded-full" style={{ width: `${(row.views / max) * 100}%`, background: caps.accent }} />
            </div>
          </div>
        );
      })}
      {!platforms.length && <p className="py-8 text-center text-[13px] text-starlight-faint">No platform data available.</p>}
    </div>
  );
}

function PlatformIntelligence({ platform, rangeDays }: { platform: PlatformAnalyticsDTO; rangeDays: AnalyticsRangeDays }) {
  const caps = PLATFORM_CAPABILITIES[platform.provider];
  const stats = platformStats(platform);
  const interactions = platform.totalInteractions ??
    platform.likes + platform.comments + platform.shares + (platform.saves ?? 0);
  const style = {
    "--platform-accent": caps.accent,
    "--platform-secondary": caps.accentSecondary,
  } as CSSProperties;
  return (
    <article className="analytics-platform-card" style={style}>
      <div className="analytics-platform-card__rail" />
      <div className="p-4 sm:p-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-12 flex-none items-center justify-center rounded-[12px] bg-void-2/75 shadow-[inset_0_0_0_1px_rgba(255,255,255,.045)]">
            <PlatformBrandMark platform={platform.provider} height={29} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[18px] font-semibold tracking-[-0.015em] text-starlight">{caps.label}</p>
            <p className="mt-1 truncate text-[12px] text-starlight-faint">{platform.handle ?? "Not connected"}</p>
          </div>
          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-display text-[9.5px] font-semibold uppercase tracking-[.12em] ${platform.ready ? "bg-[rgba(101,255,154,.075)] text-neon" : platform.connected ? "bg-[rgba(255,214,102,.07)] text-solar" : "bg-white/[.025] text-starlight-faint"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]" />
            {platform.ready ? "Live" : platform.connected ? "Limited" : "Offline"}
          </span>
        </div>

        <div className="analytics-platform-summary mt-4 flex items-center justify-between gap-3 rounded-[13px] px-3.5 py-3">
          <div>
            <p className="font-display text-[10.5px] font-semibold uppercase tracking-[.13em] text-starlight-faint">{rangeDays === "total" ? "Total views" : `${rangeDays}-day views`}</p>
            <p className="telemetry mt-1.5 text-[27px] leading-none text-starlight">{compact(platform.views)}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-[10.5px] font-semibold uppercase tracking-[.13em] text-starlight-faint">Interactions</p>
            <p className="telemetry mt-1.5 text-[23px] leading-none text-starlight-dim">{compact(interactions)}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {stats.map((stat) => (
            <div key={stat.label} className="analytics-platform-metric p-3">
              <p className="telemetry text-[25px] leading-none text-starlight">{stat.value}</p>
              <p className="mt-2.5 font-display text-[12px] font-semibold uppercase leading-[1.35] tracking-[.07em] text-starlight-dim">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 px-0.5 text-[10.5px] text-starlight-faint">
          <span>Period results + account totals</span>
          <span className="flex-none">{platform.lastSyncedAt ? `Synced ${relativeTime(platform.lastSyncedAt)}` : "No sync yet"}</span>
        </div>
      </div>
    </article>
  );
}

function TopPosts({ posts }: { posts: AnalyticsPostDTO[] }) {
  if (!posts.length) {
    return <p className="py-10 text-center text-[13.5px] text-starlight-faint">Post metrics will appear after the first analytics sync.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[660px]">
        <div className="grid grid-cols-[28px_minmax(220px,1fr)_88px_88px_72px_28px] gap-3 border-b border-[var(--glass-border)] pb-2">
          <span />
          <span className="kicker !text-[10px]">Post</span>
          <span className="kicker text-right !text-[10px]">Views</span>
          <span className="kicker text-right !text-[10px]">Interactions</span>
          <span className="kicker text-right !text-[10px]">Rate</span>
          <span />
        </div>
        {posts.map((post, index) => {
          const interactions = post.likes + post.comments + post.shares + (post.saves ?? 0);
          const rate = post.views ? (interactions / post.views) * 100 : 0;
          return (
            <div key={post.projectionId} className="grid grid-cols-[28px_minmax(220px,1fr)_88px_88px_72px_28px] items-center gap-3 border-b border-[var(--glass-border)] py-3 last:border-b-0 last:pb-0">
              <span className="telemetry text-[10.5px] text-starlight-faint">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-9 flex-none items-center justify-center rounded-[8px] bg-void-2/65">
                  <PlatformBrandMark platform={post.provider} height={19} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-starlight">{post.title}</p>
                  <p className="telemetry mt-1 text-[9.5px] text-starlight-faint">
                    {post.publishedAt ? new Date(post.publishedAt).toLocaleDateString([], { month: "short", day: "numeric" }) : "Published"}
                  </p>
                </div>
              </div>
              <p className="telemetry text-right text-[12.5px] text-starlight">{compact(post.views)}</p>
              <p className="telemetry text-right text-[12.5px] text-starlight">{compact(interactions)}</p>
              <p className="telemetry text-right text-[11.5px] text-ice">{percent(rate)}</p>
              {post.platformPostUrl ? (
                <a href={post.platformPostUrl} target="_blank" rel="noreferrer" aria-label={`Open ${post.title}`} className="text-starlight-faint transition-colors hover:text-neon">
                  <ArrowUpRight size={14} />
                </a>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EngagementMix({ totals, platform }: { totals: ReturnType<typeof summarize>; platform: PlatformFilter }) {
  const rows = [
    { label: "Likes", value: totals.likes, icon: <Heart size={13} />, color: "var(--neon)" },
    { label: platform === "threads" ? "Replies" : "Comments", value: totals.comments, icon: <MessageCircle size={13} />, color: "var(--ice)" },
    { label: platform === "threads" ? "Reposts + quotes" : "Shares", value: totals.shares, icon: <Share2 size={13} />, color: "var(--pure)" },
    { label: "Saves", value: totals.saves, icon: <Bookmark size={13} />, color: "var(--solar)" },
  ].filter((row) => row.value > 0 || row.label !== "Saves");
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="space-y-4 pt-1">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-2 flex items-center gap-2.5 text-[12px] text-starlight-dim">
            <span style={{ color: row.color }}>{row.icon}</span>
            <span>{row.label}</span>
            <span className="telemetry ml-auto text-starlight">{compact(row.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-void-3">
            <div className="h-full rounded-full" style={{ width: `${(row.value / max) * 100}%`, background: row.color }} />
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--glass-border)] pt-4">
        <SmallReadout label="Total response" value={compact(totals.interactions)} />
        <SmallReadout label="Response rate" value={percent(totals.engagementRate)} />
      </div>
    </div>
  );
}

function Coverage({ platforms }: { platforms: PlatformAnalyticsDTO[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {platforms.map((platform) => {
        const caps = PLATFORM_CAPABILITIES[platform.provider];
        return (
          <div key={platform.provider} className="rounded-[12px] bg-void-2/50 p-3.5">
            <div className="flex items-center gap-2">
              <PlatformBrandMark platform={platform.provider} height={20} />
              <p className="font-display text-[13px] font-medium text-starlight">{caps.label}</p>
              <span className="telemetry ml-auto text-[8.5px] uppercase text-starlight-faint">{platform.availableMetrics.length} signals</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {platform.availableMetrics.map((metricName) => (
                <span key={metricName} className="rounded-full bg-[rgba(124,247,255,.055)] px-2.5 py-1.5 font-display text-[10px] text-starlight-dim">
                  {metricLabel(metricName)}
                </span>
              ))}
            </div>
            {platform.metricNotes[0] && <p className="mt-3 text-[10.5px] leading-relaxed text-starlight-faint">{platform.metricNotes[0]}</p>}
          </div>
        );
      })}
    </div>
  );
}

function DeliveryBars({ rows }: { rows: Array<{ provider: PlatformId; count: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-3">
      {rows.map((row) => {
        const caps = PLATFORM_CAPABILITIES[row.provider];
        return (
          <div key={row.provider}>
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-starlight-dim">
              <span>{caps.label}</span>
              <span className="telemetry text-starlight-faint">{row.count}</span>
            </div>
            <div className="h-1 rounded-full bg-void-3">
              <div className="h-full rounded-full" style={{ width: `${(row.count / max) * 100}%`, background: caps.accent }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SmallReadout({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="telemetry text-[20px] text-starlight">{value}</p>
      <p className="kicker mt-1.5 !text-[8.5px]">{label}</p>
    </div>
  );
}

function platformStats(platform: PlatformAnalyticsDTO) {
  const interactions = platform.likes + platform.comments + platform.shares;
  if (platform.provider === "instagram") {
    return [
      { label: "Reach", value: optionalCompact(platform.reach) },
      { label: "Saves", value: optionalCompact(platform.saves) },
      { label: "Avg watch", value: optionalSeconds(platform.averageWatchSeconds) },
      { label: "Latest profile actions", value: optionalCompact(sumKnown(platform.profileViews, platform.clicks)) },
    ];
  }
  if (platform.provider === "tiktok") {
    return [
      { label: "Total likes", value: optionalCompact(platform.totalLikes) },
      { label: "Following", value: optionalCompact(platform.following) },
      { label: "Videos", value: optionalCompact(platform.publishedVideos) },
      { label: "Views / post", value: compact(platform.publishedPosts ? platform.views / platform.publishedPosts : 0) },
    ];
  }
  if (platform.provider === "facebook") {
    return [
      { label: "Page views", value: optionalCompact(platform.pageViews) },
      { label: "Post views", value: optionalCompact(platform.postViews) },
      { label: "Interactions", value: compact(interactions) },
      { label: "Watch time", value: optionalMinutes(platform.watchMinutes) },
    ];
  }
  return [
    { label: "Replies", value: optionalCompact(platform.replies ?? platform.comments) },
    { label: "Reposts", value: optionalCompact(platform.reposts) },
    { label: "Quotes", value: optionalCompact(platform.quotes) },
    { label: "Clicks", value: optionalCompact(platform.clicks) },
  ];
}

function buildSignalMetrics(
  platforms: PlatformAnalyticsDTO[],
  filter: PlatformFilter,
  rangeDays: AnalyticsRangeDays,
): SignalMetricModel[] {
  const current = summarize(platforms);
  const previous = summarizePrevious(platforms);
  return SIGNAL_METRICS[filter].map((id) => ({
    id,
    label: signalLabel(id, filter),
    value: signalValue(current, id),
    previous: signalValue(previous, id),
    series: signalSeries(platforms, id, rangeDays),
    scope: id === "audience"
      ? "Current account total"
      : id === "engagementRate"
        ? rangeDays === "total" ? "All-history rate" : `${rangeDays}-day rate`
        : id === "growth"
          ? rangeDays === "total" ? "All recorded growth" : `${rangeDays}-day net change`
          : rangeDays === "total" ? "All available activity" : `${rangeDays}-day activity`,
  }));
}

function signalSeries(
  platforms: PlatformAnalyticsDTO[],
  metric: SignalMetric,
  rangeDays: AnalyticsRangeDays,
): Array<number | null> {
  const dates = analyticsDates(platforms, rangeDays);
  if (metric === "audience") {
    const audiencePlatforms = platforms.filter((platform) => platform.audience !== undefined);
    if (!audiencePlatforms.length) {
      return dates.map(() => null);
    }
    const platformSeries = audiencePlatforms.map((platform) => {
      const netByDate = new Map(
        platform.daily.map((row) => [row.date, row.audienceGained - row.audienceLost]),
      );
      const reconstructed: Array<number | null> = Array.from({ length: dates.length }, () => null);
      let audience = platform.audience!;
      for (let index = dates.length - 1; index >= 0; index -= 1) {
        reconstructed[index] = audience;
        // A missing provider/day means no recorded change, not that the
        // complete cross-platform series should disappear.
        audience -= netByDate.get(dates[index]) ?? 0;
      }
      return reconstructed;
    });
    return dates.map((_, index) => {
      const points = platformSeries.map((values) => values[index]);
      if (!points.length || points.some((value) => value === null)) return null;
      return points.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    });
  }

  const rowsByPlatform = platforms
    .map((platform) => new Map(platform.daily.map((row) => [row.date, row])))
    .filter((rowsByDate) => rowsByDate.size > 0);
  return dates.map((date) => {
    if (!rowsByPlatform.length) return null;
    const rows = rowsByPlatform
      .map((rowsByDate) => rowsByDate.get(date))
      .filter((row): row is PlatformAnalyticsDTO["daily"][number] => row !== undefined);
    // Providers begin recording history on different dates. Aggregate every
    // row that exists for this day; do not erase valid histories merely
    // because another connected provider has not recorded that day yet.
    if (!rows.length) return null;
    const views = rows.reduce((sum, row) => sum + row.views, 0);
    const interactions = rows.reduce(
      (sum, row) => sum + row.likes + row.comments + row.shares + (row.saves ?? 0),
      0,
    );
    if (metric === "engagementRate") return views ? (interactions / views) * 100 : 0;
    if (metric === "interactions") return interactions;
    if (metric === "growth") {
      return rows.reduce((sum, row) => sum + row.audienceGained - row.audienceLost, 0);
    }
    if (metric === "views") return views;
    if (metric === "likes") return rows.reduce((sum, row) => sum + row.likes, 0);
    if (metric === "comments") return rows.reduce((sum, row) => sum + row.comments, 0);
    if (metric === "shares") return rows.reduce((sum, row) => sum + row.shares, 0);
    if (metric === "reach") {
      const known = rows.flatMap((row) => row.reach === undefined ? [] : [row.reach]);
      return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    if (metric === "saves") {
      const known = rows.flatMap((row) => row.saves === undefined ? [] : [row.saves]);
      return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    if (metric === "watchMinutes") {
      const known = rows.flatMap((row) => row.watchMinutes === undefined ? [] : [row.watchMinutes]);
      return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    return 0;
  });
}

type MetricSummary = ReturnType<typeof summarize>;

function signalValue(summary: MetricSummary, metric: SignalMetric) {
  if (metric === "audience") return summary.audienceKnown ? summary.audience : undefined;
  if (metric === "views") return summary.views;
  if (metric === "interactions") return summary.interactions;
  if (metric === "engagementRate") return summary.engagementRate;
  if (metric === "likes") return summary.likes;
  if (metric === "comments") return summary.comments;
  if (metric === "shares") return summary.shares;
  if (metric === "reach") return summary.reach;
  if (metric === "saves") return summary.savesKnown ? summary.saves : undefined;
  if (metric === "watchMinutes") return summary.watchKnown ? summary.watchMinutes : undefined;
  return summary.audienceDelta;
}

function signalLabel(metric: SignalMetric, filter: PlatformFilter) {
  if (metric === "audience") {
    if (filter === "all") return "Combined followers";
    if (filter === "facebook") return "Page followers";
    return "Followers";
  }
  if (metric === "views") return filter === "facebook" ? "Post views" : "Views";
  if (metric === "comments") return filter === "threads" ? "Replies" : "Comments";
  if (metric === "shares") return filter === "threads" ? "Reposts + quotes" : "Shares";
  if (metric === "engagementRate") return "Engagement rate";
  if (metric === "watchMinutes") return "Watch time";
  if (metric === "growth") return "Follower growth";
  return metric.charAt(0).toUpperCase() + metric.slice(1);
}

function summarizePrevious(platforms: PlatformAnalyticsDTO[]) {
  return summarize(
    platforms.map((platform) => {
      const previous = platform.previousPeriod;
      return {
        ...platform,
        audience: previous?.audience,
        audienceDelta: previous?.audienceDelta ?? 0,
        views: previous?.views ?? 0,
        likes: previous?.likes ?? 0,
        comments: previous?.comments ?? 0,
        shares: previous?.shares ?? 0,
        reach: previous?.reach,
        saves: previous?.saves,
        replies: previous?.replies,
        reposts: previous?.reposts,
        quotes: previous?.quotes,
        clicks: previous?.clicks,
        watchMinutes: previous?.watchMinutes,
        publishedPosts: previous?.publishedPosts ?? 0,
      };
    }),
  );
}

function summarize(platforms: PlatformAnalyticsDTO[]) {
  const result = platforms.reduce(
    (total, row) => ({
      audience: total.audience + (row.audience ?? 0),
      audienceKnown: total.audienceKnown || row.audience !== undefined,
      audienceDelta: total.audienceDelta + row.audienceDelta,
      views: total.views + row.views,
      likes: total.likes + row.likes,
      comments: total.comments + row.comments,
      shares: total.shares + row.shares,
      interactions: total.interactions + (
        row.totalInteractions ?? row.likes + row.comments + row.shares + (row.saves ?? 0)
      ),
      saves: total.saves + (row.saves ?? 0),
      savesKnown: total.savesKnown || row.saves !== undefined,
      reach: total.reach + (row.reach ?? 0),
      reachKnown: total.reachKnown || row.reach !== undefined,
      watchMinutes: total.watchMinutes + (row.watchMinutes ?? 0),
      watchKnown: total.watchKnown || row.watchMinutes !== undefined,
      publishedPosts: total.publishedPosts + row.publishedPosts,
    }),
    {
      audience: 0,
      audienceKnown: false,
      audienceDelta: 0,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      interactions: 0,
      saves: 0,
      savesKnown: false,
      reach: 0,
      reachKnown: false,
      watchMinutes: 0,
      watchKnown: false,
      publishedPosts: 0,
    },
  );
  return {
    ...result,
    engagementRate: result.views ? (result.interactions / result.views) * 100 : 0,
    viewsPerPost: result.publishedPosts ? result.views / result.publishedPosts : 0,
    audienceLabel: platforms.length === 1 ? platforms[0].audienceLabel : "Total followers",
    reach: result.reachKnown ? result.reach : undefined,
  };
}

function dailyMetric(row: PlatformAnalyticsDTO["daily"][number], metric: ChartMetric) {
  if (metric === "views") return row.views;
  if (metric === "interactions") return row.likes + row.comments + row.shares + (row.saves ?? 0);
  return row.audienceGained - row.audienceLost;
}

function scorePost(post: AnalyticsPostDTO) {
  const interactions = post.likes + post.comments + post.shares + (post.saves ?? 0);
  return post.views + interactions * 8;
}

function chartLabel(metric: ChartMetric) {
  return metric === "growth" ? "Follower growth" : metric === "interactions" ? "Interactions" : "Views";
}

function metricLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
}

function dateRange(days: number) {
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, index) =>
    new Date(todayUtc - (days - index - 1) * 86_400_000).toISOString().slice(0, 10),
  );
}

function analyticsDates(platforms: PlatformAnalyticsDTO[], range: AnalyticsRangeDays) {
  if (range !== "total") return dateRange(range);
  const observed = new Set(
    platforms.flatMap((platform) => platform.daily.map((row) => row.date)),
  );
  return observed.size ? [...observed].sort() : dateRange(1);
}

function rangeDescription(range: AnalyticsRangeDays) {
  return range === "total" ? "all available history" : `last ${range} days`;
}

function compact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(value);
}

function comparisonPercent(current: number | undefined, previous: number | undefined) {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatSignalValue(metric: SignalMetric, value: number | undefined) {
  if (value === undefined) return "—";
  if (metric === "engagementRate") return percent(value);
  if (metric === "watchMinutes") return optionalMinutes(value);
  if (metric === "growth") return `${value > 0 ? "+" : ""}${compact(value)}`;
  return compact(value);
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const midpoint = (previous.x + current.x) / 2;
    path += ` C ${midpoint} ${previous.y}, ${midpoint} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function percent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function optionalCompact(value: number | undefined) {
  return value === undefined ? "—" : compact(value);
}

function optionalSeconds(value: number | undefined) {
  return value === undefined ? "—" : `${value.toFixed(1)}s`;
}

function optionalMinutes(value: number | undefined) {
  if (value === undefined) return "—";
  return value >= 60 ? `${compact(value / 60)}h` : `${Math.round(value)}m`;
}

function sumKnown(...values: Array<number | undefined>) {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined;
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.round(minutes / 60)}h ago`
      : `${Math.round(minutes / 1440)}d ago`;
}
