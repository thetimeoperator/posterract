import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, Crown, Plus, Users } from "lucide-react";
import clsx from "clsx";
import { Button, EmptyState, Panel, PlatformBrandMark } from "@posterract/hyperkit";
import type { AccountAnalyticsDTO, AnalyticsPlatformId, AnalyticsRangeDays, BusinessDTO } from "@posterract/contract";
import { BusinessLogo } from "@/components/BusinessLogo";
import { useAccountAnalytics, useBusinesses } from "@/engine/useEngine";
import { useSelectedBusiness } from "@/state/business";
import "./businesses.css";

/**
 * Analytics → Businesses: every business side by side, for someone running
 * several campaigns with a group of creators on each. Which business is
 * winning, which creators carry it, who's gone quiet, who needs a reconnect.
 */

type SortKey = "views" | "growth" | "engagement" | "posts" | "points";
type Totals = {
  accounts: AccountAnalyticsDTO[];
  views: number;
  previousViews?: number;
  interactions: number;
  engagementRate?: number;
  followers?: number;
  followersGained: number;
  previousFollowersGained?: number;
  posts: number;
  previousPosts?: number;
  points: number;
  previousPoints?: number;
  failed: number;
  reconnect: number;
  quiet: number;
  daily: Array<{ date: string; views: number }>;
};

const QUIET_DAYS = 7;
const SHARE_COLORS = ["#65ff9a", "#7cf7ff", "#ffcc66", "#2ee6c5", "#c6ff7a", "#5fdcff", "#b8ffd6"];
const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "views", label: "Views" },
  { value: "growth", label: "Growth" },
  { value: "engagement", label: "Engagement" },
  { value: "posts", label: "Posts" },
  { value: "points", label: "Points" },
];

const compact = (value: number | undefined) =>
  value === undefined ? "—" : value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 });
const signed = (value: number) => `${value > 0 ? "+" : ""}${compact(value)}`;
const percent = (value: number | undefined) => (value === undefined ? "—" : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);
const isQuiet = (account: AccountAnalyticsDTO, now: number) => !account.lastPostAt || now - account.lastPostAt > QUIET_DAYS * 86_400_000;

function totalsOf(accounts: AccountAnalyticsDTO[], now: number): Totals {
  const sum = (pick: (account: AccountAnalyticsDTO) => number) => accounts.reduce((total, account) => total + pick(account), 0);
  const hasPrevious = accounts.some((account) => account.previous);
  const views = sum((account) => account.views);
  const interactions = sum((account) => account.interactions);
  const known = accounts.filter((account) => account.audience !== undefined);
  const daily = new Map<string, number>();
  for (const account of accounts) for (const point of account.daily) daily.set(point.date, (daily.get(point.date) ?? 0) + point.views);
  return {
    accounts,
    views,
    previousViews: hasPrevious ? sum((account) => account.previous?.views ?? 0) : undefined,
    interactions,
    engagementRate: views > 0 ? interactions / views : undefined,
    followers: known.length ? known.reduce((total, account) => total + (account.audience ?? 0), 0) : undefined,
    followersGained: sum((account) => account.audienceDelta),
    previousFollowersGained: hasPrevious ? sum((account) => account.previous?.audienceDelta ?? 0) : undefined,
    posts: sum((account) => account.publishedPosts),
    previousPosts: hasPrevious ? sum((account) => account.previous?.publishedPosts ?? 0) : undefined,
    points: Math.round(sum((account) => account.points) * 10) / 10,
    previousPoints: hasPrevious ? Math.round(sum((account) => account.previous?.points ?? 0) * 10) / 10 : undefined,
    failed: sum((account) => account.failedPosts),
    reconnect: accounts.filter((account) => account.status !== "connected").length,
    quiet: accounts.filter((account) => account.status === "connected" && isQuiet(account, now)).length,
    daily: [...daily.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, views: value })),
  };
}

const sortValue = (totals: Totals, key: SortKey) =>
  key === "views" ? totals.views
    : key === "growth" ? totals.followersGained
      : key === "engagement" ? totals.engagementRate ?? -1
        : key === "posts" ? totals.posts
          : totals.points;

const accountSortValue = (account: AccountAnalyticsDTO, key: SortKey) =>
  key === "views" ? account.views
    : key === "growth" ? account.audienceDelta
      : key === "engagement" ? account.engagementRate ?? -1
        : key === "posts" ? account.publishedPosts
          : account.points;

function Delta({ value, previous }: { value: number; previous?: number }) {
  if (previous === undefined) return null;
  if (previous === 0) return value > 0 ? <span className="biz-delta biz-delta--up">new</span> : null;
  const change = (value - previous) / Math.abs(previous);
  if (Math.abs(change) < 0.005) return <span className="biz-delta">0%</span>;
  const up = change > 0;
  return (
    <span className={clsx("biz-delta", up ? "biz-delta--up" : "biz-delta--down")}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(change * 100).toLocaleString(undefined, { maximumFractionDigits: Math.abs(change) < 0.1 ? 1 : 0 })}%
    </span>
  );
}

function Sparkline({ points, color = "#65ff9a" }: { points: Array<{ views: number }>; color?: string }) {
  if (points.length < 2) return <span className="biz-spark biz-spark--empty" aria-hidden />;
  const max = Math.max(1, ...points.map((point) => point.views));
  const path = points
    .map((point, index) => `${(index / (points.length - 1)) * 100},${28 - (point.views / max) * 26}`)
    .join(" ");
  return (
    <svg className="biz-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <polyline points={`0,30 ${path} 100,30`} fill={`${color}14`} stroke="none" />
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Avatar({ account }: { account: AccountAnalyticsDTO }) {
  const [failed, setFailed] = useState(false);
  const name = account.displayName || account.handle.replace(/^@/, "");
  return (
    <span className="biz-avatar" aria-hidden>
      {account.avatarUrl && !failed ? <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : name.slice(0, 1).toUpperCase()}
      <span className="biz-avatar-platform"><PlatformBrandMark platform={account.provider} height={10} decorative /></span>
    </span>
  );
}

function lastPostLabel(account: AccountAnalyticsDTO, now: number) {
  if (!account.lastPostAt) return "Never";
  const days = Math.floor((now - account.lastPostAt) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`;
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: React.ReactNode }) {
  return (
    <div className="biz-stat">
      <span className="biz-stat-label">{label}</span>
      <span className="biz-stat-value">{value}</span>
      {delta}
    </div>
  );
}

/** The creators in one business (or in none), sortable, with who's carrying it and who's gone quiet. */
function CreatorsTable({ accounts, now, onOpenAccount }: { accounts: AccountAnalyticsDTO[]; now: number; onOpenAccount: (id: string) => void }) {
  const [sort, setSort] = useState<SortKey>("views");
  const rows = [...accounts].sort((left, right) => accountSortValue(right, sort) - accountSortValue(left, sort));
  const top = [...accounts].sort((left, right) => right.views - left.views)[0];
  const header = (key: SortKey | undefined, label: string) => (
    <th scope="col" className={key ? "biz-sortable" : undefined}>
      {key ? (
        <button type="button" onClick={() => setSort(key)} aria-pressed={sort === key}>
          {label}{sort === key && <ChevronDown size={11} />}
        </button>
      ) : label}
    </th>
  );
  return (
    <div className="biz-table-wrap">
      <table className="biz-table">
        <thead>
          <tr>
            {header(undefined, "Creator")}
            {header("growth", "Followers")}
            {header("views", "Views")}
            {header("engagement", "Engagement")}
            {header("posts", "Posts")}
            {header(undefined, "Last post")}
            {header("points", "Points")}
            {header(undefined, "Status")}
          </tr>
        </thead>
        <tbody>
          {rows.map((account) => {
            const quiet = account.status === "connected" && isQuiet(account, now);
            return (
              <tr key={account.accountId} onClick={() => onOpenAccount(account.accountId)} className="biz-row" title="Open this creator in Overview">
                <td>
                  <span className="biz-creator">
                    <Avatar account={account} />
                    <span className="min-w-0">
                      <span className="biz-creator-name">
                        {account.displayName || account.handle}
                        {top?.accountId === account.accountId && account.views > 0 && accounts.length > 1 && <span className="biz-top"><Crown size={10} /> Top</span>}
                      </span>
                      <span className="biz-creator-handle">{account.handle}</span>
                    </span>
                  </span>
                </td>
                <td><span className="biz-cell">{compact(account.audience)}<small className={account.audienceDelta >= 0 ? "text-auroral" : "text-redshift"}>{account.audienceDelta ? signed(account.audienceDelta) : ""}</small></span></td>
                <td><span className="biz-cell">{compact(account.views)}<Delta value={account.views} previous={account.previous?.views} /></span></td>
                <td>{percent(account.engagementRate)}</td>
                <td>{account.publishedPosts}</td>
                <td className={quiet ? "text-solar" : undefined}>{lastPostLabel(account, now)}</td>
                <td>{compact(account.points)}</td>
                <td>
                  {account.status !== "connected"
                    ? <span className="biz-status biz-status--warn">Reconnect</span>
                    : account.failedPosts > 0
                      ? <span className="biz-status biz-status--warn">{account.failedPosts} failed</span>
                      : quiet
                        ? <span className="biz-status biz-status--quiet">Quiet</span>
                        : <span className="biz-status">● Active</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function BusinessesView({ rangeDays, platform, onOpenAccount }: {
  rangeDays: AnalyticsRangeDays;
  platform: "all" | AnalyticsPlatformId;
  onOpenAccount: (accountId: string) => void;
}) {
  const data = useAccountAnalytics(rangeDays);
  const businesses = useBusinesses();
  const selected = useSelectedBusiness();
  const [sort, setSort] = useState<SortKey>("views");
  const [open, setOpen] = useState<Set<string>>(() => new Set(selected ? [selected.id] : []));
  const now = useMemo(() => Date.now(), [data]);
  useEffect(() => { if (selected) setOpen((current) => new Set(current).add(selected.id)); }, [selected]);

  const accounts = useMemo(
    () => (data?.accounts ?? []).filter((account) => platform === "all" || account.provider === platform),
    [data, platform],
  );
  const rows = useMemo(() => businesses
    .map((business) => ({ business, totals: totalsOf(accounts.filter((account) => business.accountIds.includes(account.accountId)), now) }))
    .sort((left, right) => sortValue(right.totals, sort) - sortValue(left.totals, sort)),
  [businesses, accounts, sort, now]);
  const grouped = new Set(businesses.flatMap((business) => business.accountIds));
  const portfolio = useMemo(() => totalsOf(accounts.filter((account) => grouped.has(account.accountId)), now), [accounts, businesses, now]);
  const unassigned = accounts.filter((account) => !grouped.has(account.accountId));
  const shareTotal = rows.reduce((total, row) => total + row.totals.views, 0);
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (businesses.length === 0) {
    return (
      <Panel className="min-h-[40vh]">
        <EmptyState
          title="Compare your businesses here"
          detail="Group your creators' accounts into businesses (one per brand or campaign) to see every business side by side, with each creator's numbers inside it."
          action={<Link to="/portals"><Button variant="primary" icon={<Plus size={14} />}>Create a business</Button></Link>}
        />
      </Panel>
    );
  }
  if (!data) {
    return <Panel className="min-h-[40vh]"><EmptyState title="Loading your businesses" detail="Adding up every creator's numbers." /></Panel>;
  }

  return (
    <div className="space-y-4" data-testid="businesses-analytics">
      <section className="biz-summary" aria-label="All businesses">
        <Stat label="Businesses" value={String(businesses.length)} delta={<span className="biz-stat-note"><Users size={11} />{portfolio.accounts.length} creator accounts</span>} />
        <Stat label="Views" value={compact(portfolio.views)} delta={<Delta value={portfolio.views} previous={portfolio.previousViews} />} />
        <Stat label="Followers gained" value={signed(portfolio.followersGained)} delta={<Delta value={portfolio.followersGained} previous={portfolio.previousFollowersGained} />} />
        <Stat label="Engagement" value={percent(portfolio.engagementRate)} delta={<span className="biz-stat-note">{compact(portfolio.interactions)} interactions</span>} />
        <Stat label="Posts" value={String(portfolio.posts)} delta={<Delta value={portfolio.posts} previous={portfolio.previousPosts} />} />
        <Stat label="Points" value={compact(portfolio.points)} delta={<Delta value={portfolio.points} previous={portfolio.previousPoints} />} />
      </section>

      {shareTotal > 0 && (
        <section className="glass biz-share" aria-label="Share of views">
          <div className="biz-share-head">
            <span className="kicker">Share of views</span>
            <span className="biz-share-note">Which business the views come from</span>
          </div>
          <div className="biz-share-bar">
            {rows.filter((row) => row.totals.views > 0).map((row, index) => (
              <span key={row.business.id} style={{ width: `${(row.totals.views / shareTotal) * 100}%`, background: SHARE_COLORS[index % SHARE_COLORS.length] }} title={`${row.business.name}: ${Math.round((row.totals.views / shareTotal) * 100)}%`} />
            ))}
          </div>
          <div className="biz-share-legend">
            {rows.filter((row) => row.totals.views > 0).map((row, index) => (
              <span key={row.business.id}>
                <i style={{ background: SHARE_COLORS[index % SHARE_COLORS.length] }} />
                <BusinessLogo name={row.business.name} logoUrl={row.business.logoUrl} size={16} />
                {row.business.name}
                <b>{Math.round((row.totals.views / shareTotal) * 100)}%</b>
              </span>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="biz-board-title">
        <div className="biz-board-head">
          <div>
            <p className="kicker">Every business, ranked</p>
            <h2 id="biz-board-title" className="biz-board-title">Businesses</h2>
          </div>
          <div className="biz-sort" role="radiogroup" aria-label="Rank businesses by">
            {SORTS.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={sort === option.value} onClick={() => setSort(option.value)}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="space-y-2.5">
          {rows.map(({ business, totals }, index) => (
            <BusinessRow key={business.id} business={business} totals={totals} rank={index + 1} color={SHARE_COLORS[index % SHARE_COLORS.length]}
              open={open.has(business.id)} onToggle={() => toggle(business.id)} now={now} onOpenAccount={onOpenAccount} highlighted={selected?.id === business.id} />
          ))}
        </div>
      </section>

      {unassigned.length > 0 && (
        <details className="glass biz-unassigned">
          <summary>
            <span>Not in a business</span>
            <span className="biz-stat-note">{unassigned.length} account{unassigned.length === 1 ? "" : "s"} · add them to a business in Social accounts</span>
          </summary>
          <CreatorsTable accounts={unassigned} now={now} onOpenAccount={onOpenAccount} />
        </details>
      )}
    </div>
  );
}

function BusinessRow({ business, totals, rank, color, open, onToggle, now, onOpenAccount, highlighted }: {
  business: BusinessDTO;
  totals: Totals;
  rank: number;
  color: string;
  open: boolean;
  onToggle: () => void;
  now: number;
  onOpenAccount: (id: string) => void;
  highlighted: boolean;
}) {
  const issues = [
    totals.reconnect ? `${totals.reconnect} to reconnect` : "",
    totals.failed ? `${totals.failed} failed post${totals.failed === 1 ? "" : "s"}` : "",
    totals.quiet ? `${totals.quiet} quiet ${QUIET_DAYS}+ days` : "",
  ].filter(Boolean);
  return (
    <article className={clsx("glass biz-row-card", open && "is-open", highlighted && "is-highlighted")} style={{ ["--biz-color" as string]: color }}>
      <button type="button" className="biz-row-main" onClick={onToggle} aria-expanded={open}>
        <span className="biz-rank">#{rank}</span>
        <span className="biz-identity">
          <BusinessLogo name={business.name} logoUrl={business.logoUrl} size={38} />
          <span className="min-w-0">
            <span className="biz-name">{business.name}</span>
            <span className="biz-creators">
              <span className="biz-stack">{totals.accounts.slice(0, 5).map((account) => <Avatar key={account.accountId} account={account} />)}</span>
              {totals.accounts.length} creator{totals.accounts.length === 1 ? "" : "s"}
            </span>
          </span>
        </span>
        <span className="biz-row-stats">
          <Stat label="Views" value={compact(totals.views)} delta={<Delta value={totals.views} previous={totals.previousViews} />} />
          <Stat label="Followers" value={signed(totals.followersGained)} delta={<span className="biz-stat-note">{compact(totals.followers)} total</span>} />
          <Stat label="Engagement" value={percent(totals.engagementRate)} />
          <Stat label="Posts" value={String(totals.posts)} delta={<Delta value={totals.posts} previous={totals.previousPosts} />} />
          <Stat label="Points" value={compact(totals.points)} delta={<Delta value={totals.points} previous={totals.previousPoints} />} />
        </span>
        <span className="biz-row-trend"><Sparkline points={totals.daily} color={color} /></span>
        <ChevronDown size={16} className={clsx("biz-chevron", open && "rotate-180")} />
      </button>
      {issues.length > 0 && (
        <p className="biz-issues"><AlertTriangle size={12} />{issues.join(" · ")}</p>
      )}
      {open && (
        <Fragment>
          {totals.accounts.length === 0
            ? <p className="biz-empty">No accounts in {business.name} yet. Add them in Social accounts.</p>
            : <CreatorsTable accounts={totals.accounts} now={now} onOpenAccount={onOpenAccount} />}
        </Fragment>
      )}
    </article>
  );
}
