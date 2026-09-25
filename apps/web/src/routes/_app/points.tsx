import { useMemo, useState, type CSSProperties } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, Eye, Flame, Lock, Rocket, Trophy, Zap, type LucideIcon } from "lucide-react";
import { PlatformBrandMark } from "@posterract/hyperkit";
import {
  BADGES,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  PLATFORM_CAPABILITIES,
  POINTS_FOLLOWER_MILESTONES,
  POINTS_PERSONAL_BEST,
  POINTS_PLATFORMS,
  POINTS_POST_LIVE,
  POINTS_RATES,
  POINTS_RETENTION,
  POINTS_SOURCE_LABELS,
  POINTS_START_AT,
  POINTS_STREAK_MILESTONES,
  RANK_TIERS,
  RANK_TITLES,
  rankForLevel,
  type FollowerMilestoneDTO,
  type LeaderboardEntryDTO,
  type LeaderboardPeriod,
  type PointsDashboardDTO,
  type PointsEntryDTO,
  type PointsPlatform,
  type PointsSource,
  type PostPointsDTO,
} from "@posterract/contract";
import { useLeaderboard, usePointsDashboard } from "@/engine/useEngine";
import { RankEmblem, TIER_MATERIALS } from "@/components/points/RankEmblem";
import { Medal } from "@/components/points/Medal";
import "@/styles/points.css";

export const Route = createFileRoute("/_app/points")({ component: Points });

type PointsView = "mine" | "leaderboard";

const PERIODS: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
];

const PERIOD_WORDS: Record<LeaderboardPeriod, string> = {
  week: "this week",
  month: "this month",
  all: "all time",
};

/** The medals the scorer awards, roughly in the order creators earn them. */
const MEDALS: Array<{ id: string; icon: LucideIcon; mark?: string; detail: string }> = [
  { id: "first_transmission", icon: Rocket, detail: "A post goes live" },
  { id: "streak_7", icon: Flame, mark: "7", detail: "Post 7 days in a row" },
  { id: "record", icon: Trophy, detail: "Beat your best views" },
  { id: "breakout", icon: Zap, detail: "3× your usual views" },
  { id: "streak_30", icon: Flame, mark: "30", detail: "Post 30 days in a row" },
  { id: "club_100k", icon: Eye, mark: "100K", detail: "A post passes 100K views" },
  { id: "streak_100", icon: Flame, mark: "100", detail: "Post 100 days in a row" },
  { id: "streak_365", icon: Flame, mark: "365", detail: "Post every day for a year" },
];

// The top three: neon, cyan, white.
const PODIUM_RGB = ["101, 255, 154", "124, 247, 255", "234, 255, 243"];

function Points() {
  const [view, setView] = useState<PointsView>("mine");
  const dashboard = usePointsDashboard();
  const level = dashboard?.level ?? 1;
  return (
    <div className="career" style={tierStyle(level)} data-testid="points-page">
      <header className="career-head">
        <Contours seed={2} />
        <div className="career-head__main">
          <p className="career-head__kicker">◆ Levels &amp; leaderboard</p>
          <h1 className="career-head__title">Points</h1>
          <div className="career-tabs" role="tablist" aria-label="Points view">
            <Tab selected={view === "mine"} onSelect={() => setView("mine")}>My Points</Tab>
            <Tab selected={view === "leaderboard"} onSelect={() => setView("leaderboard")}>Leaderboard</Tab>
          </div>
        </div>
        {dashboard && (
          <div className="career-chip">
            <RankEmblem level={dashboard.level} size={46} />
            <div>
              <p className="career-chip__name">{dashboard.rank.label}</p>
              <p className="career-chip__level">Level {dashboard.level}</p>
            </div>
          </div>
        )}
      </header>
      {view === "mine" ? <MyPoints dashboard={dashboard} /> : <Leaderboard />}
    </div>
  );
}

function Tab({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: string }) {
  return (
    <button type="button" role="tab" aria-selected={selected} className="career-tab" onClick={onSelect}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// My Points
// ---------------------------------------------------------------------------

function MyPoints({ dashboard }: { dashboard?: PointsDashboardDTO }) {
  if (!dashboard) {
    return (
      <section className="cr-panel">
        <div className="cr-empty">
          <strong>Loading your rank</strong>
          Adding up what your posts have earned.
        </div>
      </section>
    );
  }
  return (
    <>
      <Hero dashboard={dashboard} />
      <TierLadder level={dashboard.level} />
      <div className="career-grid career-grid--main">
        <TopPosts posts={dashboard.topPosts} />
        <div className="career-stack">
          <Streak streak={dashboard.streak} timeZone={dashboard.timeZone} />
          <Followers accounts={dashboard.followers} />
        </div>
      </div>
      <div className="career-grid career-grid--even">
        <Medals unlocked={dashboard.badges} />
        <RecentPoints entries={dashboard.recent} />
      </div>
      <Scoring />
    </>
  );
}

function Hero({ dashboard }: { dashboard: PointsDashboardDTO }) {
  const { level, levelFloor, nextLevelAt, totalPoints } = dashboard;
  const rank = rankForLevel(level);
  const tier = RANK_TIERS[rank.tierIndex]!;
  const next = nextLevelAt === null ? undefined : rankForLevel(level + 1);
  const span = nextLevelAt === null ? 0 : nextLevelAt - levelFloor;
  const progress = nextLevelAt === null ? 1 : Math.min(1, Math.max(0, (totalPoints - levelFloor) / Math.max(1, span)));
  return (
    <section className="career-hero" aria-label="Your rank">
      <Contours seed={5} />
      <div className="hero-emblem">
        <RankEmblem level={level} size={228} gleam />
        <div className="hero-emblem__plate">
          <span className="cr-label">Level</span>
          <span className="hero-emblem__level">{level}</span>
        </div>
      </div>

      <div className="hero-main">
        <p className="cr-label">Current rank</p>
        <h2 className="rank-name">{rank.label}</h2>
        <p className="rank-sub">
          <span><b>{tier.label}</b> · tier {rank.tierIndex + 1} of {RANK_TIERS.length}</span>
          <span>Level <b>{level}</b> of {MAX_LEVEL}</span>
        </p>

        <div className="xp">
          <div className="xp__top">
            <p className="xp__count">
              {formatPoints(totalPoints - levelFloor)}
              <span>/ {nextLevelAt === null ? "MAX" : formatPoints(span)} pts</span>
            </p>
            {next ? (
              <p className="xp__next">
                <span>Next · <b>{next.label}</b></span>
                <RankEmblem level={level + 1} size={30} glow={false} />
              </p>
            ) : (
              <p className="xp__next"><b>Top rank reached</b></p>
            )}
          </div>
          <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Progress to the next level">
            <div className="xp-bar__fill" style={{ width: `${progress * 100}%` }} />
            <div className="xp-bar__ticks" />
          </div>
          <p className="xp__foot">
            {nextLevelAt === null ? (
              <>Level {MAX_LEVEL}. Nothing above this.</>
            ) : (
              <><b>{formatPoints(nextLevelAt - totalPoints)}</b> pts to level {level + 1}</>
            )}
          </p>
        </div>

        <div className="tier-pips" aria-label={`${rank.title}, ${rank.titleIndex + 1} of ${RANK_TITLES.length} in ${tier.label}`}>
          {RANK_TITLES.map((title, index) => (
            <span
              key={title}
              title={`${tier.label} ${title}`}
              className={
                index < rank.titleIndex ? "tier-pip tier-pip--done" : index === rank.titleIndex ? "tier-pip tier-pip--current" : "tier-pip"
              }
            />
          ))}
        </div>
        <p className="tier-pips__legend">
          <span>{RANK_TITLES[0]}</span>
          <span><b>{rank.title}</b> · {rank.titleIndex + 1} of {RANK_TITLES.length}</span>
          <span>{RANK_TITLES[RANK_TITLES.length - 1]}</span>
        </p>
      </div>

      <div className="hero-stats">
        <HeroStat label="Total points" value={formatPoints(totalPoints)} />
        <HeroStat label="This week" value={`+${formatPoints(dashboard.weekPoints)}`} up />
        <HeroStat label="This month" value={`+${formatPoints(dashboard.monthPoints)}`} up />
      </div>
    </section>
  );
}

function HeroStat({ label, value, up }: { label: string; value: string; up?: boolean }) {
  return (
    <div className="hero-stat">
      <p className="cr-label">{label}</p>
      <p className={up ? "hero-stat__value hero-stat__value--up" : "hero-stat__value"}>{value}</p>
    </div>
  );
}

function TierLadder({ level }: { level: number }) {
  const current = rankForLevel(level).tierIndex;
  const stops = RANK_TIERS.length;
  const edge = 100 / stops / 2;
  return (
    <section className="cr-panel" aria-label="Rank tiers">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Rank progression</h3>
        <p className="cr-panel__meta">Lv {MAX_LEVEL} = {formatCompact(LEVEL_THRESHOLDS[MAX_LEVEL - 1]!)} pts</p>
      </header>
      <div className="tier-track">
        <span className="tier-track__rail" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <span className="tier-track__fill" style={{ left: `${edge}%`, width: `${(current / stops) * 100}%` }} />
        {RANK_TIERS.map((tier, index) => {
          const firstLevel = index * RANK_TITLES.length + 1;
          const state = index < current ? "done" : index === current ? "current" : "locked";
          // Finished tiers show their General, the current one your own rank.
          const shown = state === "done" ? firstLevel + RANK_TITLES.length - 1 : state === "current" ? level : firstLevel;
          return (
            <div key={tier.id} className={`tier-stop tier-stop--${state}`}>
              <div className="tier-stop__emblem">
                <RankEmblem level={shown} size={state === "current" ? 76 : 60} locked={state === "locked"} glow={state !== "locked"} />
                {state === "locked" && (
                  <span className="tier-stop__lock" aria-hidden>
                    <Lock size={10} strokeWidth={2.4} />
                  </span>
                )}
              </div>
              <p className="tier-stop__name">{tier.label}</p>
              <p className="tier-stop__req">Lv {firstLevel} · {formatCompact(LEVEL_THRESHOLDS[firstLevel - 1]!)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopPosts({ posts }: { posts: PostPointsDTO[] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = posts.find((post) => post.projectionId === selectedId) ?? posts[0];
  return (
    <section className="cr-panel" aria-label="Top posts">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Top posts</h3>
        <p className="cr-panel__meta">After action report</p>
      </header>
      {posts.length === 0 || !selected ? (
        <div className="cr-empty">
          <strong>No points from posts yet</strong>
          A post earns 1 point when it goes live, then more as its views and engagement come in.
          <div>
            <Link to="/compose" className="cr-cta">New post</Link>
          </div>
        </div>
      ) : (
        <div className="aar">
          <div className="aar__list">
            {posts.map((post, index) => (
              <button
                key={post.projectionId}
                type="button"
                className="aar-row"
                aria-pressed={post.projectionId === selected.projectionId}
                onClick={() => setSelectedId(post.projectionId)}
              >
                <span className="aar-row__pos">{String(index + 1).padStart(2, "0")}</span>
                <span className="aar-row__mark">
                  <PlatformBrandMark platform={post.provider} height={18} decorative />
                </span>
                <span className="min-w-0">
                  <span className="aar-row__title block">{post.title}</span>
                  <span className="aar-row__sub block">
                    {PLATFORM_CAPABILITIES[post.provider].label}
                    {post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
                  </span>
                </span>
                <span className="aar-row__pts">+{formatPoints(post.total)}</span>
              </button>
            ))}
          </div>
          <div className="aar__detail">
            <p className="cr-label">Points breakdown</p>
            <p className="aar__detail-title">{selected.title}</p>
            <div className="aar__lines">
              {selected.parts.map((part) => {
                const metric = partMetric(part.source, part.value);
                return (
                  <div key={part.source} className="aar-line">
                    <span className="aar-line__label">{POINTS_SOURCE_LABELS[part.source] ?? part.source}</span>
                    {metric && <span className="aar-line__metric">{metric}</span>}
                    <span className="aar-line__pts">+{formatPoints(part.points)}</span>
                  </div>
                );
              })}
            </div>
            <div className="aar__total">
              <span className="cr-label">Total</span>
              <span className="aar__total-value">+{formatPoints(selected.total)}</span>
            </div>
            {selected.url && (
              <a href={selected.url} target="_blank" rel="noreferrer" className="aar__open">
                Open post <ArrowUpRight size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Streak({ streak, timeZone }: { streak: PointsDashboardDTO["streak"]; timeZone?: string }) {
  const { current, best, next } = streak;
  const milestones = POINTS_STREAK_MILESTONES;
  // The rail is split evenly between milestones; progress fills the segment you are in.
  let fill = 1;
  for (let index = 0; index < milestones.length; index += 1) {
    const from = index === 0 ? 0 : milestones[index - 1]!.days;
    const to = milestones[index]!.days;
    if (current < to) {
      fill = (index + (current - from) / (to - from)) / milestones.length;
      break;
    }
  }
  const daysLeft = next ? next.days - current : 0;
  return (
    <section className="cr-panel" aria-label="Daily streak">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Daily streak</h3>
        <p className="cr-panel__meta">
          {next ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} to +${formatCompact(next.points)}` : "All milestones"}
        </p>
      </header>
      <div className="cr-panel__body">
        <div className="streak">
          <span className={current > 0 ? "streak__flame" : "streak__flame streak__flame--cold"}>
            <Flame size={40} strokeWidth={1.8} />
          </span>
          <span className="streak__days">{current}</span>
          <span className="streak__unit">{current === 1 ? "Day" : "Days"}<br />in a row</span>
          <span className="streak__best">
            <span className="cr-label">Best</span>
            <span className="cr-num">{best}</span>
          </span>
        </div>
        <div className="streak-track">
          <div className="streak-track__rail" />
          <div className="streak-track__fill" style={{ width: `${fill * 100}%` }} />
          {milestones.map((milestone, index) => (
            <div
              key={milestone.days}
              className={current >= milestone.days ? "streak-node streak-node--done" : "streak-node"}
              style={{ left: `${((index + 1) / milestones.length) * 100}%` }}
            >
              <span className="streak-node__gem" />
              <span className="streak-node__label">
                {milestone.days}d<span>+{formatCompact(milestone.points)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="streak__note">
          A day counts when a new video goes live. Each milestone pays once per streak.
          {timeZone ? ` Days follow ${timeZone.replaceAll("_", " ")} time.` : ""}
        </p>
      </div>
    </section>
  );
}

function Followers({ accounts }: { accounts: FollowerMilestoneDTO[] }) {
  return (
    <section className="cr-panel" aria-label="Follower milestones">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Follower milestones</h3>
        <p className="cr-panel__meta">1 pt per 100 new</p>
      </header>
      <div className="cr-panel__body">
        {accounts.length === 0 ? (
          <div className="cr-empty">
            <strong>No accounts yet</strong>
            Connect Instagram, Facebook, or Threads. Every 100 followers you gain after that is worth a point.
            <div>
              <Link to="/portals" className="cr-cta">Connect an account</Link>
            </div>
          </div>
        ) : (
          accounts.map((account) => {
            const next = account.next;
            const passed = next
              ? [...POINTS_FOLLOWER_MILESTONES].reverse().find((milestone) => milestone.followers < next.followers)
              : undefined;
            const floor = Math.max(account.baseline, passed?.followers ?? 0);
            const progress = next ? Math.min(1, Math.max(0, (account.followers - floor) / Math.max(1, next.followers - floor))) : 1;
            const lit = Math.round(progress * 24);
            const growth = account.followers - account.baseline;
            return (
              <div key={account.accountId} className="follower">
                <div className="follower__top">
                  <span className="aar-row__mark">
                    <PlatformBrandMark platform={account.provider} height={18} decorative />
                  </span>
                  <div className="min-w-0">
                    <p className="follower__handle">{account.handle}</p>
                    <p className="follower__gain">{growth >= 0 ? "+" : "−"}{formatWhole(Math.abs(growth))} new followers counted</p>
                  </div>
                  <p className="follower__count">{formatCompact(account.followers)}</p>
                </div>
                <div className="segbar" aria-hidden>
                  {Array.from({ length: 24 }, (_, index) => <i key={index} className={index < lit ? "on" : undefined} />)}
                </div>
                <p className="follower__next">
                  <span>{next ? `${formatWhole(next.followers - account.followers)} to ${formatCompact(next.followers)}` : "Every milestone reached"}</span>
                  {next && <b>+{formatPoints(next.points)}</b>}
                </p>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function Medals({ unlocked }: { unlocked: string[] }) {
  const have = new Set(unlocked);
  const count = MEDALS.filter((medal) => have.has(medal.id)).length;
  return (
    <section className="cr-panel" aria-label="Medals">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Medals</h3>
        <p className="cr-panel__meta">{count} of {MEDALS.length} unlocked</p>
      </header>
      <div className="cr-panel__body">
        <div className="medal-grid">
          {MEDALS.map((medal) => {
            const on = have.has(medal.id);
            return (
              <div key={medal.id} className={on ? "medal-cell medal-cell--on" : "medal-cell medal-cell--off"}>
                <Medal icon={medal.icon} mark={medal.mark} unlocked={on} />
                <p className="medal-cell__name">{BADGES[medal.id] ?? medal.id}</p>
                <p className="medal-cell__detail">{medal.detail}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RecentPoints({ entries }: { entries: PointsEntryDTO[] }) {
  return (
    <section className="cr-panel" aria-label="Recent points">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">Recent points</h3>
        <p className="cr-panel__meta">Live feed</p>
      </header>
      <div className="cr-panel__body">
        {entries.length === 0 ? (
          <div className="cr-empty">
            <strong>Nothing yet</strong>
            Points you earn show up here as they land.
          </div>
        ) : (
          <div className="log">
            {entries.map((entry) => (
              <div key={entry.id} className="log-row">
                <span className="log-row__pts">+{formatPoints(entry.amount)}</span>
                <span className="log-row__note" title={entry.note}>
                  {entry.note ?? POINTS_SOURCE_LABELS[entry.source] ?? entry.source}
                </span>
                <span className="log-row__time">{relativeTime(entry.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Scoring() {
  const rows: Array<{ label: string; cell: (platform: PointsPlatform) => string | null }> = [
    { label: "Post goes live", cell: () => `+${POINTS_POST_LIVE}` },
    { label: "Views", cell: (platform) => `1 per ${formatWhole(POINTS_RATES[platform].views)}` },
    { label: "Likes", cell: (platform) => `1 per ${formatWhole(POINTS_RATES[platform].likes)}` },
    { label: "Comments", cell: (platform) => `1 per ${formatWhole(POINTS_RATES[platform].comments)}` },
    { label: "Shares", cell: (platform) => `1 per ${formatWhole(POINTS_RATES[platform].shares)}` },
    {
      label: "Saves",
      cell: (platform) => {
        const saves = POINTS_RATES[platform].saves;
        return saves ? `1 per ${formatWhole(saves)}` : null;
      },
    },
    { label: "Watch time", cell: (platform) => (POINTS_RATES[platform].watchHours ? "1 per hour" : null) },
    {
      label: "Retention",
      cell: (platform) =>
        POINTS_RATES[platform].watchHours
          ? POINTS_RETENTION.tiers.map((tier) => `+${tier.points} at ${tier.share * 100}%`).join(" · ")
          : null,
    },
  ];
  const bonuses = [
    { label: "Personal record", value: `+${POINTS_PERSONAL_BEST.record}`, detail: "A post beats your best views on that account." },
    {
      label: "Breakout",
      value: `+${POINTS_PERSONAL_BEST.breakout}`,
      detail: `A post gets ${POINTS_PERSONAL_BEST.breakoutMultiple}× your usual views.`,
    },
    {
      label: "Streaks",
      value: POINTS_STREAK_MILESTONES.map((milestone) => `${milestone.days}d +${formatCompact(milestone.points)}`).join(" · "),
      detail: "Once per streak. Break it and the milestones can be earned again.",
    },
    {
      label: "Followers",
      value: `${formatCompact(POINTS_FOLLOWER_MILESTONES[0].followers)} to ${formatCompact(POINTS_FOLLOWER_MILESTONES.at(-1)!.followers)}`,
      detail: "1 point per 100 new followers, paid at each milestone. Followers you already had don't count.",
    },
  ];
  return (
    <section className="cr-panel" aria-label="How points are earned">
      <header className="cr-panel__head">
        <h3 className="cr-panel__title">How points are earned</h3>
        <p className="cr-panel__meta">Per post, per platform</p>
      </header>
      <div className="cr-panel__body">
        <div className="overflow-x-auto">
          <table className="score-table">
            <thead>
              <tr>
                <th>Action</th>
                {POINTS_PLATFORMS.map((platform) => (
                  <th key={platform}>
                    <span className="score-table__brand">
                      <PlatformBrandMark platform={platform} height={14} decorative />
                      {PLATFORM_CAPABILITIES[platform].label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {POINTS_PLATFORMS.map((platform) => {
                    const value = row.cell(platform);
                    return (
                      <td key={platform} className={value ? undefined : "off"}>
                        {value ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bonus-grid">
          {bonuses.map((bonus) => (
            <div key={bonus.label} className="bonus-card">
              <p className="cr-label">{bonus.label}</p>
              <p className="bonus-card__value">{bonus.value}</p>
              <p className="bonus-card__detail">{bonus.detail}</p>
            </div>
          ))}
        </div>
        <p className="score-note">
          Everyone started at Bronze Recruit on {formatLaunchDay()}: only posts from that day on earn points. Points keep
          adding up as a post's numbers grow, fractions included. Retention counts from day{" "}
          {POINTS_RETENTION.minAgeHours / 24} on posts with {formatWhole(POINTS_RETENTION.minViews)}+ views. Records and
          breakouts need {formatWhole(POINTS_PERSONAL_BEST.minViews)}+ views and {POINTS_PERSONAL_BEST.minEarlierPosts}{" "}
          earlier posts. TikTok and YouTube posts don't earn points yet.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

function Leaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const board = useLeaderboard(period);
  const podium = board?.entries.slice(0, 3) ?? [];
  const rest = board?.entries.slice(3) ?? [];
  const me = board?.me;
  const pinned = me && !board.entries.some((entry) => entry.isMe) ? me : undefined;
  const topShare = me && board.total > 0 ? Math.max(1, Math.ceil((me.position / board.total) * 100)) : undefined;
  // #2, #1, #3 left to right, the way a podium stands.
  const podiumOrder = [podium[1], podium[0], podium[2]].filter((entry): entry is LeaderboardEntryDTO => Boolean(entry));

  return (
    <section className="cr-panel" aria-label="Leaderboard">
      <div className="board-head">
        <div className="career-tabs" role="tablist" aria-label="Leaderboard period">
          {PERIODS.map((option) => (
            <Tab key={option.value} selected={period === option.value} onSelect={() => setPeriod(option.value)}>
              {option.label}
            </Tab>
          ))}
        </div>
        <div className="board-head__meta">
          <p className="cr-label">{board ? `${formatWhole(board.total)} creators` : "Creators"}</p>
          <b>{me ? `You're #${me.position}${topShare ? ` · top ${topShare}%` : ""}` : "—"}</b>
        </div>
      </div>

      {!board ? (
        <div className="cr-empty">
          <strong>Loading the leaderboard</strong>
          Ranking every creator on a Posterract plan.
        </div>
      ) : board.entries.length === 0 ? (
        <div className="cr-empty">
          <strong>No one on the board yet</strong>
          Creators appear here once they're on a Posterract plan.
        </div>
      ) : (
        <>
          <div className="podium">
            {podiumOrder.map((entry) => (
              <div
                key={entry.position}
                className={`podium-card podium-card--${entry.position}${entry.isMe ? " podium-card--me" : ""}`}
                style={{ "--place-rgb": PODIUM_RGB[entry.position - 1] } as CSSProperties}
              >
                <span className="podium-card__place">{entry.position}</span>
                <RankEmblem level={entry.level} size={entry.position === 1 ? 118 : 92} />
                <p className="podium-card__name">
                  {entry.name}
                  {entry.isMe && <span className="board-you">You</span>}
                </p>
                <p className="podium-card__rank">{entry.rank.label} · Lv {entry.level}</p>
                <p className="podium-card__pts">{formatPoints(entry.points)}</p>
                <p className="cr-label podium-card__pts-label">Points {PERIOD_WORDS[period]}</p>
              </div>
            ))}
          </div>

          {(rest.length > 0 || pinned) && (
            <div className="board-table">
              <div className="board-row board-row--head">
                <span>#</span>
                <span />
                <span>Creator</span>
                <span className="board-row__rank">Rank</span>
                <span className="board-row__level">Level</span>
                <span className="text-right">Points</span>
              </div>
              {rest.map((entry) => (
                <StandingRow key={entry.position} entry={entry} />
              ))}
              {pinned && (
                <>
                  <p className="board-gap" aria-hidden>···</p>
                  <StandingRow entry={pinned} />
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StandingRow({ entry }: { entry: LeaderboardEntryDTO }) {
  return (
    <div className={entry.isMe ? "board-row board-row--me" : "board-row"}>
      <span className="board-row__pos">{entry.position}</span>
      <RankEmblem level={entry.level} size={36} glow={false} />
      <span className="board-row__who">
        <CreatorAvatar name={entry.name} src={entry.avatarUrl} size={28} />
        <span className="board-row__name">{entry.name}</span>
        {entry.isMe && <span className="board-you">You</span>}
      </span>
      <span className="board-row__rank">{entry.rank.label}</span>
      <span className="board-row__level">{entry.level}</span>
      <span className="board-row__pts">{formatPoints(entry.points)}</span>
    </div>
  );
}

function CreatorAvatar({ name, src, size }: { name: string; src?: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span className="cr-avatar" style={{ width: size, height: size }}>
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Topographic contour lines, like the maps behind Call of Duty's menus. */
function Contours({ seed }: { seed: number }) {
  const paths = useMemo(() => contourPaths(seed), [seed]);
  return (
    <svg className="cr-contours" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  );
}

function contourPaths(seed: number) {
  const centers: Array<[number, number]> = [[930, 120], [170, 400]];
  const mid = (a: [number, number], b: [number, number]) => `${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`;
  const paths: string[] = [];
  centers.forEach(([cx, cy], centerIndex) => {
    for (let ring = 0; ring < 9; ring += 1) {
      const base = 34 + ring * 32;
      const points: Array<[number, number]> = [];
      for (let step = 0; step < 64; step += 1) {
        const angle = (step / 64) * Math.PI * 2;
        const wobble =
          1 +
          0.14 * Math.sin(3 * angle + ring * 0.55 + seed + centerIndex) +
          0.07 * Math.sin(5 * angle - ring * 0.8 + seed * 2);
        points.push([cx + Math.cos(angle) * base * wobble * 1.4, cy + Math.sin(angle) * base * wobble]);
      }
      let d = `M${mid(points[0]!, points[1]!)}`;
      for (let index = 1; index <= points.length; index += 1) {
        const point = points[index % points.length]!;
        const following = points[(index + 1) % points.length]!;
        d += ` Q${point[0].toFixed(1)} ${point[1].toFixed(1)} ${mid(point, following)}`;
      }
      paths.push(`${d} Z`);
    }
  });
  return paths;
}

/** The tier's colours for the page: its glow and the ink its name is written in. */
function tierStyle(level: number): CSSProperties {
  const material = TIER_MATERIALS[rankForLevel(level).tier];
  return {
    "--tier-rgb": hexToRgb(material.ink[1]),
    "--tier-ink-1": material.ink[0],
    "--tier-ink-2": material.ink[1],
  } as CSSProperties;
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

/** What a rule measured, shown beside its points: "48.2K", "96.5 h", "58%". */
function partMetric(source: PointsSource, value: number | undefined) {
  if (value === undefined) return undefined;
  if (source === "watch") return `${formatPoints(value)} h`;
  if (source === "retention") return `${Math.round(value)}% watched`;
  if (["views", "likes", "comments", "shares", "saves"].includes(source)) return formatCompact(value);
  return undefined;
}

function formatLaunchDay() {
  return new Date(POINTS_START_AT).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPoints(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatWhole(value: number) {
  return Math.round(value).toLocaleString();
}

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 0,
  }).format(value);
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10_080) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}
