import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Crown, Flame, Swords, Target, TriangleAlert, Trophy } from "lucide-react";
import { PlatformBrandMark } from "@posterract/hyperkit";
import {
  ANALYTICS_PLATFORM_IDS,
  PLATFORM_CAPABILITIES,
  type AccountPostDTO,
  type AccountPostsDTO,
  type AnalyticsPlatformId,
  type AnalyticsRangeDays,
  type BusinessDTO,
  type PlatformId,
  type PortalDTO,
  type ProjectionDTO,
  type TransmissionDTO,
} from "@posterract/contract";
import type { AnalyticsScope } from "@/engine/store";
import "./posting-cadence.css";

/**
 * Posts per day, one neon line per connected account — the top of
 * Analytics. Counts every post on each account by the local day it went
 * live, whichever app or tool made it (the platforms' own post lists, read
 * each hour), and follows the page's range, platform and account filters.
 * Hovering a line (or the avatar at its end) names its account; a player
 * card focuses its line and a click on the card hides it.
 */

const DAY_MS = 86_400_000;
const LINE_COLORS = [
  "101,255,154",
  "124,247,255",
  "255,60,140",
  "255,170,64",
  "90,150,255",
  "255,226,102",
  "255,100,90",
  "196,255,77",
] as const;

type Series = {
  account: PortalDTO;
  color: string;
  counts: number[];
  total: number;
  best: number;
  streak: number;
  rank: number;
};

type Pointer = { day: number; accountId?: string };

/** Connected, or connected until the platform withdrew access (shown with a reconnect note). */
const onGraph = (account: PortalDTO) =>
  (account.status === "connected" || account.status === "needs_reauth") &&
  (ANALYTICS_PLATFORM_IDS as readonly PlatformId[]).includes(account.provider);
type LineStyle = CSSProperties & { "--line": string; "--i"?: number };

export function PostingCadence({
  portals,
  accountPosts,
  projections,
  transmissions,
  businesses,
  rangeDays,
  platform,
  scope,
}: {
  portals: PortalDTO[];
  /** Every post from the platforms' lists; undefined while loading, null where there are none (the demo engine). */
  accountPosts: AccountPostsDTO | null | undefined;
  projections: ProjectionDTO[];
  transmissions: TransmissionDTO[];
  businesses: BusinessDTO[];
  rangeDays: AnalyticsRangeDays;
  platform: "all" | AnalyticsPlatformId;
  scope: AnalyticsScope;
}) {
  const accounts = useMemo(() => {
    const business = businesses.find((item) => item.id === scope.businessId);
    return portals.filter((account) =>
      onGraph(account) &&
      (platform === "all" || account.provider === platform) &&
      (!business || business.accountIds.includes(account.id)) &&
      (!scope.accountIds || scope.accountIds.includes(account.id)));
  }, [portals, businesses, platform, scope.businessId, scope.accountIds]);

  // Each account keeps its color whatever the filters show.
  const palette = useMemo(
    () => new Map(
      portals
        .filter(onGraph)
        .map((account, index) => [account.id, LINE_COLORS[index % LINE_COLORS.length]]),
    ),
    [portals],
  );
  const { days, series } = useMemo(
    () => buildSeries(accounts, accountPosts?.posts ?? null, projections, transmissions, rangeDays, palette),
    [accounts, accountPosts, projections, transmissions, rangeDays, palette],
  );

  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const [cardFocus, setCardFocus] = useState<string>();
  const [pointer, setPointer] = useState<Pointer>();
  const visible = useMemo(() => series.filter((row) => !muted.has(row.account.id)), [series, muted]);
  const focus = pointer?.accountId ?? cardFocus;

  const totals = days.map((_, index) => visible.reduce((sum, row) => sum + row.counts[index], 0));
  const totalPosts = totals.reduce((sum, value) => sum + value, 0);
  const bestDay = totals.reduce((best, value, index) => (value > best.value ? { value, index } : best), { value: 0, index: -1 });
  const streak = trailingStreak(totals);
  const activeDays = totals.filter((value) => value > 0).length;
  const leaderId = visible.reduce<Series | undefined>((best, row) => (row.total > (best?.total ?? 0) ? row : best), undefined)?.account.id;
  const ranked = [...series].sort((left, right) => left.rank - right.rank);
  // A new connection whose past posts are still being read.
  const reading = new Set(accountPosts?.syncing ?? []);
  const topTotal = Math.max(1, ...series.map((row) => row.total));

  const toggle = (id: string) =>
    setMuted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (series.length - next.size > 1) next.add(id);
      return next;
    });
  const point = (next: Pointer | undefined) =>
    setPointer((current) =>
      current?.day === next?.day && current?.accountId === next?.accountId ? current : next);

  if (!accounts.length) {
    return (
      <section className="cadence" aria-labelledby="cadence-title">
        <CadenceHeader />
        <div className="cadence-empty">
          <p>No connected accounts in this view.</p>
          <Link to="/portals" className="cadence-empty-link">Connect an account</Link>
        </div>
      </section>
    );
  }

  if (accountPosts === undefined) {
    return (
      <section className="cadence" aria-labelledby="cadence-title" data-testid="posting-cadence">
        <CadenceHeader />
        <div className="cadence-loading" role="status">Reading every post on your accounts…</div>
      </section>
    );
  }

  return (
    <section className="cadence" aria-labelledby="cadence-title" data-testid="posting-cadence">
      <span className="cadence-corner cadence-corner--tl" aria-hidden />
      <span className="cadence-corner cadence-corner--tr" aria-hidden />
      <span className="cadence-corner cadence-corner--bl" aria-hidden />
      <span className="cadence-corner cadence-corner--br" aria-hidden />
      <div className="cadence-top">
        <CadenceHeader days={days.length} />
        <div className="cadence-hud" role="group" aria-label="Posting summary">
          <HudStat icon={<Swords size={12} />} label="Posts" note={`${visible.length} account${visible.length === 1 ? "" : "s"}`}>
            <CountUp value={totalPosts} />
          </HudStat>
          <HudStat icon={<Target size={12} />} label="Per day" note={`${activeDays} active day${activeDays === 1 ? "" : "s"}`}>
            <CountUp value={totalPosts / Math.max(1, days.length)} decimals={1} />
          </HudStat>
          <HudStat icon={<Trophy size={12} />} label="Best day" note={bestDay.index >= 0 ? shortDate(days[bestDay.index]) : "—"}>
            <CountUp value={bestDay.value} />
          </HudStat>
          <HudStat icon={<Flame size={12} />} label="Streak" note={streak >= 3 ? "On fire" : streak > 0 ? "Keep it going" : "Post to start one"} hot={streak >= 3}>
            <CountUp value={streak} suffix="d" />
          </HudStat>
        </div>
      </div>

      <CadenceChart
        days={days}
        series={visible}
        totals={totals}
        focus={focus}
        pointer={pointer}
        onPointer={point}
        leaderId={leaderId}
      />

      <ul className="cadence-players" data-cols={Math.min(4, ranked.length)} aria-label="Accounts">
        {ranked.map((row, index) => {
          const id = row.account.id;
          const off = muted.has(id);
          const reconnect = row.account.status === "needs_reauth";
          return (
            <li key={id}>
              <button
                type="button"
                className="cadence-player"
                data-off={off || undefined}
                data-reconnect={reconnect || undefined}
                data-focus={focus === id || undefined}
                style={{ "--line": row.color, "--i": index } as LineStyle}
                aria-pressed={!off}
                title={off ? "Show this line" : "Hide this line"}
                onClick={() => toggle(id)}
                onPointerEnter={() => setCardFocus(id)}
                onPointerLeave={() => setCardFocus(undefined)}
                onFocus={() => setCardFocus(id)}
                onBlur={() => setCardFocus(undefined)}
              >
                <span className="cadence-player-rank">{String(row.rank).padStart(2, "0")}</span>
                <Avatar account={row.account} className="cadence-player-avatar" />
                <span className="cadence-player-body">
                  <span className="cadence-player-handle">
                    <span>{row.account.handle}</span>
                    {leaderId === id && <Crown size={12} className="cadence-crown" aria-hidden />}
                  </span>
                  {reconnect ? (
                    <span className="cadence-player-meta cadence-player-reconnect">
                      <TriangleAlert size={11} aria-hidden />
                      {PLATFORM_CAPABILITIES[row.account.provider].label} · reconnect on Accounts
                    </span>
                  ) : reading.has(id) ? (
                    <span className="cadence-player-meta cadence-player-reading">
                      {PLATFORM_CAPABILITIES[row.account.provider].label} · reading past posts…
                    </span>
                  ) : (
                    <span className="cadence-player-meta">
                      {PLATFORM_CAPABILITIES[row.account.provider].label} · {row.streak > 0 ? `${row.streak}d streak` : row.best ? `best ${row.best}/day` : "no posts yet"}
                    </span>
                  )}
                  <span className="cadence-player-xp" aria-hidden>
                    <span style={{ width: `${(row.total / topTotal) * 100}%` }} />
                  </span>
                </span>
                <span className="cadence-player-score">
                  <CountUp value={row.total} />
                  <small>posts</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CadenceHeader({ days }: { days?: number }) {
  return (
    <div className="cadence-head">
      <p className="cadence-kicker"><span className="cadence-live" aria-hidden />Posting cadence{days ? ` · ${days}D` : ""}</p>
      <h2 id="cadence-title" className="cadence-title">Posts per day, every account</h2>
    </div>
  );
}

function HudStat({ icon, label, note, hot, children }: { icon: ReactNode; label: string; note?: string; hot?: boolean; children: ReactNode }) {
  return (
    <div className="cadence-stat" data-hot={hot || undefined}>
      <span className="cadence-stat-label">{icon}{label}</span>
      <span className="cadence-stat-value">{children}</span>
      {note ? <span className="cadence-stat-note">{note}</span> : null}
    </div>
  );
}

/** Rolls a number up to its new value, like a score counter. */
function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = from.current;
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (start === value || still) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / 900);
      const next = start + (value - start) * (1 - Math.pow(1 - progress, 3));
      from.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown.toFixed(decimals)}{suffix}</>;
}

function Avatar({ account, className }: { account: PortalDTO; className: string }) {
  const [broken, setBroken] = useState(false);
  const photo = account.avatarUrl && !broken ? account.avatarUrl : undefined;
  return (
    <span className={className} aria-hidden>
      {photo
        ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <PlatformBrandMark platform={account.provider} height={14} decorative />}
      {photo && <span className="cadence-badge"><PlatformBrandMark platform={account.provider} height={8} decorative /></span>}
    </span>
  );
}

const PAD = { top: 24, right: 52, bottom: 50, left: 34 };
const HEIGHT = 300;
const HEAD_RADIUS = 14;
/** How close (px) the pointer must be to a line to name its account. */
const HIT_DISTANCE = 16;

function CadenceChart({
  days,
  series,
  totals,
  focus,
  pointer,
  onPointer,
  leaderId,
}: {
  days: Date[];
  series: Series[];
  totals: number[];
  focus?: string;
  pointer?: Pointer;
  onPointer: (pointer: Pointer | undefined) => void;
  leaderId?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.clientWidth);
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotBottom = HEIGHT - PAD.bottom;
  const ready = width > 0;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  const innerH = plotBottom - PAD.top;
  const ticks = yTicks(Math.max(1, ...series.flatMap((row) => row.counts)));
  const top = ticks.at(-1) ?? 1;
  const step = days.length > 1 ? innerW / (days.length - 1) : innerW;
  const x = (index: number) => PAD.left + (days.length > 1 ? index * step : innerW / 2);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const todayX = x(days.length - 1);
  const headX = todayX + 26;

  const lines = series.map((row, index) => {
    const points = row.counts.map((count, day) => ({ x: x(day), y: y(count) }));
    const tangents = monotoneTangents(points);
    return { row, index, points, tangents, path: curvePath(points, tangents) };
  });
  const heads = placeHeads(
    lines.map(({ row, points }) => ({ id: row.account.id, y: points.at(-1)!.y })),
    PAD.top + 2,
    plotBottom - 2,
    HEAD_RADIUS * 2 + 4,
  );
  // Draw the focused line last so it sits on top.
  const drawOrder = focus
    ? [...lines.filter((line) => line.row.account.id !== focus), ...lines.filter((line) => line.row.account.id === focus)]
    : lines;
  // Replay the draw-in when the window of days changes.
  const drawKey = `${days.length}:${days[0]?.getTime()}`;
  const reveal = useRef<SVGRectElement>(null);
  const laser = useRef<HTMLDivElement>(null);
  // The lines are drawn in behind a laser; one frame loop moves both, so
  // the beam stays exactly on the edge of what has been drawn.
  useLayoutEffect(() => {
    const rect = reveal.current;
    const beam = laser.current;
    if (!ready || !rect) return;
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      rect.style.transform = "";
      return;
    }
    const span = rect.width.baseVal.value;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 1200);
      const progress = 1 - Math.pow(1 - t, 3);
      rect.style.transform = `scaleX(${progress})`;
      if (beam) {
        beam.style.transform = `translateX(${progress * span}px)`;
        beam.style.opacity = String(t < 0.05 ? t / 0.05 : t > 0.8 ? (1 - t) / 0.2 : 1);
      }
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    rect.style.transform = "scaleX(0)";
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drawKey, ready]);
  const maxTotal = Math.max(1, ...totals);
  const quiet = totals.every((value) => value === 0);
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 70))));
  const labels = days
    .map((day, index) => ({ day, index }))
    .filter(({ index }) => index === days.length - 1 || (index % labelEvery === 0 && days.length - 1 - index >= labelEvery * 0.6));

  const locate = (event: PointerEvent<HTMLDivElement>) => {
    if (!width) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const day = clamp(Math.round((px - PAD.left) / step), 0, days.length - 1);
    // The avatar at the end of a line names its account too.
    for (const line of lines) {
      const id = line.row.account.id;
      if (Math.hypot(px - headX, py - heads.get(id)!) <= HEAD_RADIUS + 3) {
        onPointer({ day: days.length - 1, accountId: id });
        return;
      }
    }
    let accountId: string | undefined;
    if (py <= plotBottom + 6 && px <= todayX + 8) {
      let nearest = HIT_DISTANCE;
      for (const line of lines) {
        const distance = Math.abs(curveY(line.points, line.tangents, px) - py);
        if (distance <= nearest) {
          nearest = distance;
          accountId = line.row.account.id;
        }
      }
    }
    onPointer({ day, accountId });
  };

  const hoveredLine = pointer?.accountId ? lines.find((line) => line.row.account.id === pointer.accountId) : undefined;
  const lit = lines.find((line) => line.row.account.id === focus);
  const chipWidth = Math.min(244, Math.max(180, width - 8));

  return (
    <div
      ref={frame}
      className="cadence-chart"
      data-focused={focus ? "" : undefined}
      onPointerMove={locate}
      onPointerLeave={() => onPointer(undefined)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label={`Posts per day for ${series.length} account${series.length === 1 ? "" : "s"} over the last ${days.length} days`}
        >
          <defs>
            <clipPath id={`${uid}-reveal`}>
              <rect ref={reveal} key={drawKey} className="cadence-reveal" x={0} y={0} width={width} height={HEIGHT} />
            </clipPath>
            <filter id={`${uid}-glow`} filterUnits="userSpaceOnUse" x={0} y={0} width={width} height={HEIGHT}>
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
            {/* Older days fade back, so today reads first. */}
            <linearGradient id={`${uid}-fade`} gradientUnits="userSpaceOnUse" x1={PAD.left} x2={todayX} y1={0} y2={0}>
              <stop offset="0" stopColor="#fff" stopOpacity=".2" />
              <stop offset=".55" stopColor="#fff" stopOpacity=".62" />
              <stop offset="1" stopColor="#fff" stopOpacity="1" />
            </linearGradient>
            <mask id={`${uid}-trail`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={HEIGHT}>
              <rect x={0} y={0} width={width} height={HEIGHT} fill={`url(#${uid}-fade)`} />
            </mask>
            <radialGradient id={`${uid}-floor`} cx=".5" cy="1" r=".75">
              <stop offset="0" stopColor="rgb(101,255,154)" stopOpacity=".11" />
              <stop offset="1" stopColor="rgb(101,255,154)" stopOpacity="0" />
            </radialGradient>
            {lit && (
              <linearGradient id={`${uid}-area`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={PAD.top} y2={plotBottom}>
                <stop offset="0" stopColor={`rgb(${lit.row.color})`} stopOpacity=".3" />
                <stop offset="1" stopColor={`rgb(${lit.row.color})`} stopOpacity="0" />
              </linearGradient>
            )}
          </defs>

          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill={`url(#${uid}-floor)`} />
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="cadence-grid" x1={PAD.left} x2={todayX} y1={y(tick)} y2={y(tick)} data-zero={tick === 0 || undefined} />
              <text className="cadence-axis" x={PAD.left - 10} y={y(tick)} textAnchor="end" dominantBaseline="middle">{tick}</text>
            </g>
          ))}
          <line className="cadence-today" x1={todayX} x2={todayX} y1={PAD.top - 8} y2={plotBottom} />

          {pointer && (
            <g className="cadence-cursor" style={{ "--line": hoveredLine?.row.color ?? "101,255,154" } as LineStyle} aria-hidden>
              <rect x={x(pointer.day) - Math.max(6, step / 2)} y={PAD.top} width={Math.max(12, step)} height={innerH} />
              <line x1={x(pointer.day)} x2={x(pointer.day)} y1={PAD.top} y2={plotBottom} />
            </g>
          )}

          {/* Every day's combined posts, as a heat strip under the lines. */}
          {totals.map((value, index) => {
            const cell = clamp(step * 0.72, 2, 16);
            return (
              <rect
                key={index}
                className="cadence-heat"
                x={x(index) - cell / 2}
                y={plotBottom + 11}
                width={cell}
                height={5}
                rx={1.5}
                data-empty={value === 0 || undefined}
                data-peak={(value > 0 && value === maxTotal) || undefined}
                data-hover={pointer?.day === index || undefined}
                style={{ "--heat": value / maxTotal } as CSSProperties}
              />
            );
          })}
          {labels.map(({ day, index }) => (
            <text key={day.getTime()} className="cadence-axis" x={x(index)} y={HEIGHT - 10} textAnchor="middle" data-today={index === days.length - 1 || undefined}>
              {index === days.length - 1 ? "TODAY" : shortDate(day)}
            </text>
          ))}

          <g clipPath={`url(#${uid}-reveal)`}>
            {drawOrder.map(({ row, points, path }) => {
              const id = row.account.id;
              const isLit = focus === id;
              const last = points.at(-1)!;
              const headY = heads.get(id)!;
              return (
                <g
                  key={id}
                  className="cadence-series"
                  data-lit={isLit || undefined}
                  data-dim={(focus !== undefined && !isLit) || undefined}
                  style={{ "--line": row.color } as LineStyle}
                  mask={isLit ? undefined : `url(#${uid}-trail)`}
                >
                  {isLit && <path className="cadence-area" d={`${path} L ${last.x} ${y(0)} L ${points[0].x} ${y(0)} Z`} fill={`url(#${uid}-area)`} />}
                  <path className="cadence-line-glow" d={path} />
                  <path className="cadence-line" d={path} />
                  <path className="cadence-line-core" d={path} />
                  <path
                    className="cadence-leader"
                    d={`M ${last.x} ${last.y} C ${last.x + 10} ${last.y}, ${headX - HEAD_RADIUS - 10} ${headY}, ${headX - HEAD_RADIUS} ${headY}`}
                  />
                </g>
              );
            })}

            {lit && lit.row.counts.map((count, index) =>
              count > 0 && !(hoveredLine && pointer?.day === index) ? (
                <circle key={index} className="cadence-dot" style={{ "--line": lit.row.color } as LineStyle} cx={lit.points[index].x} cy={lit.points[index].y} r={2.8} />
              ) : null,
            )}
            {pointer && !hoveredLine && lines.map(({ row, points }) => (
              <circle
                key={row.account.id}
                className="cadence-dot"
                data-solid
                style={{ "--line": row.color } as LineStyle}
                cx={points[pointer.day].x}
                cy={points[pointer.day].y}
                r={3.6}
              />
            ))}
            {pointer && hoveredLine && (
              <g style={{ "--line": hoveredLine.row.color } as LineStyle}>
                <circle className="cadence-hit-ring" cx={hoveredLine.points[pointer.day].x} cy={hoveredLine.points[pointer.day].y} r={9} />
                <circle className="cadence-dot" data-solid cx={hoveredLine.points[pointer.day].x} cy={hoveredLine.points[pointer.day].y} r={4.5} />
              </g>
            )}
          </g>
        </svg>
      )}

      {width > 0 && (
        <div key={`laser-${drawKey}`} className="cadence-laser-track" style={{ top: PAD.top - 8, height: innerH + 8 }} aria-hidden>
          <div ref={laser} className="cadence-laser" />
        </div>
      )}

      {width > 0 && lines.map(({ row }) => {
        const id = row.account.id;
        return (
          <span
            key={`${id}:${drawKey}`}
            className="cadence-racer"
            data-lit={focus === id || undefined}
            data-dim={(focus !== undefined && focus !== id) || undefined}
            style={{ left: headX, top: heads.get(id), "--line": row.color } as LineStyle}
            aria-hidden
          >
            <Avatar account={row.account} className="cadence-racer-face" />
            {leaderId === id && <Crown size={11} className="cadence-racer-crown" />}
          </span>
        );
      })}

      {width > 0 && quiet && (
        <div className="cadence-quiet" style={{ left: PAD.left, top: PAD.top, width: innerW, height: innerH }}>
          <p>No posts in the last {days.length} days</p>
          <span>Post today and start a streak</span>
        </div>
      )}

      {pointer && hoveredLine && (() => {
        const anchor = hoveredLine.points[pointer.day];
        const count = hoveredLine.row.counts[pointer.day];
        const below = anchor.y - PAD.top < 86;
        return (
          <div
            key={hoveredLine.row.account.id}
            className="cadence-chip"
            data-below={below || undefined}
            role="status"
            style={{
              left: clamp(anchor.x - chipWidth / 2, 4, width - chipWidth - 4),
              top: anchor.y,
              width: chipWidth,
              "--line": hoveredLine.row.color,
            } as LineStyle}
          >
            <Avatar account={hoveredLine.row.account} className="cadence-chip-avatar" />
            <span className="cadence-chip-body">
              <span className="cadence-chip-handle">{hoveredLine.row.account.handle}</span>
              <span className="cadence-chip-meta">
                <PlatformBrandMark platform={hoveredLine.row.account.provider} height={10} decorative />
                {PLATFORM_CAPABILITIES[hoveredLine.row.account.provider].label} · #{hoveredLine.row.rank}
              </span>
            </span>
            <span className="cadence-chip-count">
              <span className="cadence-chip-number">{count}</span>
              <span className="cadence-chip-unit">{pointer.day === days.length - 1 ? "today" : shortDate(days[pointer.day])}</span>
            </span>
          </div>
        );
      })()}

      {pointer && !hoveredLine && (() => {
        const left = x(pointer.day);
        const flip = left > width * 0.62;
        return (
          <div
            className="cadence-tip"
            role="status"
            style={{ left: flip ? undefined : left + 14, right: flip ? width - left + 14 : undefined }}
          >
            <p className="cadence-tip-day">{longDate(days[pointer.day])}</p>
            <p className="cadence-tip-total"><span>{totals[pointer.day]}</span> post{totals[pointer.day] === 1 ? "" : "s"}</p>
            <ul>
              {lines
                .map(({ row }) => ({ row, count: row.counts[pointer.day] }))
                .sort((left, right) => right.count - left.count)
                .map(({ row, count }) => (
                  <li key={row.account.id} style={{ "--line": row.color } as LineStyle} data-zero={count === 0 || undefined}>
                    <span className="cadence-tip-swatch" />
                    <PlatformBrandMark platform={row.account.provider} height={11} decorative />
                    <span className="cadence-tip-handle">{row.account.handle}</span>
                    <span className="cadence-tip-count">{count}</span>
                  </li>
                ))}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}

function buildSeries(
  accounts: PortalDTO[],
  accountPosts: AccountPostDTO[] | null,
  projections: ProjectionDTO[],
  transmissions: TransmissionDTO[],
  rangeDays: AnalyticsRangeDays,
  palette: Map<string, string>,
): { days: Date[]; series: Series[] } {
  const today = startOfDay(Date.now());
  const ids = new Set(accounts.map((account) => account.id));
  const scheduled = new Map(transmissions.map((row) => [row.id, row.scheduledFor]));
  const posts = accountPosts
    ? accountPosts
      .filter((post) => ids.has(post.accountId))
      .map((post) => ({ accountId: post.accountId, at: Math.min(Date.now(), post.publishedAt) }))
    : projections
      .filter((row) => row.status === "live" && ids.has(row.portalId))
      .map((row) => ({
        accountId: row.portalId,
        at: Math.min(Date.now(), row.publishedAt ?? scheduled.get(row.transmissionId) ?? row.updatedAt),
      }));

  let length: number;
  if (rangeDays === "total") {
    const first = posts.reduce((min, post) => Math.min(min, post.at), Date.now());
    length = Math.min(120, Math.max(14, dayDiff(startOfDay(first), today) + 1));
  } else {
    length = rangeDays;
  }
  const days = Array.from({ length }, (_, index) => addDays(today, index - length + 1));
  const start = days[0].getTime();

  const series: Series[] = accounts.map((account, index) => {
    const counts = new Array<number>(length).fill(0);
    for (const post of posts) {
      if (post.accountId !== account.id || post.at < start) continue;
      const slot = dayDiff(days[0], startOfDay(post.at));
      if (slot >= 0 && slot < length) counts[slot] += 1;
    }
    return {
      account,
      color: palette.get(account.id) ?? LINE_COLORS[index % LINE_COLORS.length],
      counts,
      total: counts.reduce((sum, value) => sum + value, 0),
      best: Math.max(0, ...counts),
      streak: trailingStreak(counts),
      rank: 0,
    };
  });
  series
    .map((row, index) => ({ row, index }))
    .sort((left, right) => right.row.total - left.row.total || left.index - right.index)
    .forEach(({ row }, place) => { row.rank = place + 1; });
  return { days, series };
}

/** Days in a row ending today (or yesterday, if today has no post yet). */
function trailingStreak(counts: number[]): number {
  let index = counts.length - 1;
  if (index >= 0 && counts[index] === 0) index -= 1;
  let streak = 0;
  while (index >= 0 && counts[index] > 0) {
    streak += 1;
    index -= 1;
  }
  return streak;
}

function yTicks(peak: number): number[] {
  const step = peak <= 4 ? 1 : peak <= 10 ? 2 : Math.ceil(peak / 5);
  const ticks: number[] = [];
  for (let value = 0; value < peak + step; value += step) ticks.push(value);
  return ticks;
}

type Point = { x: number; y: number };

/** Fritsch–Carlson tangents: a smooth line that never dips below zero or overshoots a peak. */
function monotoneTangents(points: Point[]): number[] {
  const n = points.length;
  if (n < 2) return points.map(() => 0);
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    slopes.push((points[i + 1].y - points[i].y) / (points[i + 1].x - points[i].x || 1));
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    if (slopes[i - 1] * slopes[i] <= 0) return 0;
    return (slopes[i - 1] + slopes[i]) / 2;
  });
  for (let i = 0; i < n - 1; i += 1) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      tangents[i] = t * a * slopes[i];
      tangents[i + 1] = t * b * slopes[i];
    }
  }
  return tangents;
}

function curvePath(points: Point[], tangents: number[]): string {
  if (points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const dx = (points[i + 1].x - points[i].x) / 3;
    d += ` C ${points[i].x + dx} ${points[i].y + tangents[i] * dx}, ${points[i + 1].x - dx} ${points[i + 1].y - tangents[i + 1] * dx}, ${points[i + 1].x} ${points[i + 1].y}`;
  }
  return d;
}

/** The curve's height at `px`. Its control points are evenly spaced in x, so x is linear in t. */
function curveY(points: Point[], tangents: number[], px: number): number {
  const last = points.length - 1;
  if (last < 1 || px <= points[0].x) return points[0].y;
  if (px >= points[last].x) return points[last].y;
  const i = clamp(Math.floor((px - points[0].x) / (points[1].x - points[0].x)), 0, last - 1);
  const a = points[i];
  const b = points[i + 1];
  const t = (px - a.x) / (b.x - a.x);
  const dx = (b.x - a.x) / 3;
  const c1 = a.y + tangents[i] * dx;
  const c2 = b.y - tangents[i + 1] * dx;
  const u = 1 - t;
  return u * u * u * a.y + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * b.y;
}

/**
 * Stacks the avatars at the ends of the lines so none overlap: avatars that
 * would collide group around the average of where their lines end.
 */
function placeHeads(items: Array<{ id: string; y: number }>, min: number, max: number, gap: number): Map<string, number> {
  type Cluster = { ids: string[]; targets: number[]; top: number };
  const settle = (cluster: Cluster) => {
    const span = (cluster.ids.length - 1) * gap;
    const center = cluster.targets.reduce((sum, value) => sum + value, 0) / cluster.targets.length;
    cluster.top = Math.min(Math.max(center - span / 2, min), Math.max(min, max - span));
  };
  const clusters: Cluster[] = [];
  for (const item of [...items].sort((left, right) => left.y - right.y)) {
    let cluster: Cluster = { ids: [item.id], targets: [item.y], top: item.y };
    settle(cluster);
    while (clusters.length) {
      const previous = clusters[clusters.length - 1];
      if (previous.top + (previous.ids.length - 1) * gap + gap <= cluster.top) break;
      clusters.pop();
      cluster = { ids: [...previous.ids, ...cluster.ids], targets: [...previous.targets, ...cluster.targets], top: 0 };
      settle(cluster);
    }
    clusters.push(cluster);
  }
  const placed = new Map<string, number>();
  for (const cluster of clusters) cluster.ids.forEach((id, index) => placed.set(id, cluster.top + index * gap));
  return placed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function startOfDay(at: number): Date {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dayDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
