import { postgres, withTransaction } from "./db.js";
import { githubTokenConfigured, sealToken, openToken } from "./github-token.js";

/**
 * Phase H — the community backend (§4.2, §11).
 *
 * This is what replaces the sample data behind the Wall and Rankings: real
 * ship days pulled from GitHub, a real points ledger, real posts and reactions.
 *
 * Two rules run through all of it:
 *
 *   1. The points ledger is append-only and every idempotent award carries a
 *      ref_id, with a unique index behind it. A retried GitHub sync, a double
 *      click on 🔥, a replayed job — none of them can pay twice.
 *
 *   2. Nothing here ever returns an email address. The Wall and Rankings are
 *      public-facing surfaces, so a person is only ever identified by the
 *      handle they chose, their display name, or an opaque fallback.
 */

/* ========================================================================== */
/* the rules — all the tunable numbers live here and nowhere else              */
/* ========================================================================== */

/**
 * These values MUST stay identical to src/lib/points.ts on the website (design
 * plan 6.1), because the Rankings tab prints that table to members as the
 * rules. A number that differs here makes the published rules a lie.
 */
export const POINTS = {
  /** a day with at least one GitHub contribution. Once a day. */
  ship: 10,
  /** every 7th consecutive day */
  streak7: 25,
  /** first post each day */
  post: 5,
  /** paid to the AUTHOR, once per person who fires it */
  fire: 1,
  /** Sina featuring a post */
  pick: 50,
  /** winning the weekly challenge */
  challenge: 100,
};

/** "up to +20 a post" — past that, more reactions stop paying. */
export const FIRE_CAP_PER_POST = 20;

/** Only the first post of the day earns. */
const SCORING_POSTS_PER_DAY = 1;

/** A hard limit on posting, so the Wall cannot be flooded. */
export const POSTS_PER_DAY = 5;

/**
 * All-time points needed for each level. Index 0 is level 1.
 *
 * These MUST stay identical to src/lib/levels.ts on the website (design plan
 * 6.2): ROOKIE, BUILDER, SHIPPER, SAVAGE, APEX SAVAGE. The website renders the
 * level name from its own copy, so a threshold that differs here would show a
 * member one level while the database recorded another.
 */
const LEVEL_THRESHOLDS = [0, 100, 500, 1500, 5000];

export function levelForPoints(pointsAll) {
  let level = 1;
  for (let index = 0; index < LEVEL_THRESHOLDS.length; index += 1) {
    if (pointsAll >= LEVEL_THRESHOLDS[index]) level = index + 1;
  }
  return level;
}

/** What the UI needs to draw a progress bar toward the next level. */
export function levelProgress(pointsAll) {
  const level = levelForPoints(pointsAll);
  const floor = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const ceiling = LEVEL_THRESHOLDS[level] ?? null;
  if (ceiling === null) return { level, floor, ceiling: null, progress: 1 };
  return {
    level,
    floor,
    ceiling,
    progress: Math.min(1, Math.max(0, (pointsAll - floor) / (ceiling - floor))),
  };
}

/* ========================================================================== */
/* identity for display — never an email                                       */
/* ========================================================================== */

/**
 * A handle is what the member chose. Without one we fall back to their display
 * name, and failing that to an opaque label derived from the account id.
 *
 * The id fallback is deliberate: the obvious alternative is the local part of
 * their email, and that leaks an address onto a public leaderboard.
 */
export function displayHandle({ handle, display_name, account_id }) {
  if (handle) return handle;
  const fromName = (display_name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  if (fromName.length >= 3) return fromName;
  return `member_${String(account_id).replace(/-/g, "").slice(0, 6)}`;
}

/**
 * How far through the current membership month somebody is, 0..1.
 *
 * The moon beside a member's name fills up across the month and goes full when
 * the next payment lands, so this is measured from their own join date rather
 * than from the 1st: a member who joined on the 20th is halfway through their
 * month on the 5th, not on the 15th.
 */
export function memberProgressFrom(memberSince, monthsElapsed, now = new Date()) {
  if (!memberSince) return 0;
  const start = new Date(memberSince);
  if (Number.isNaN(start.getTime())) return 0;

  const windowStart = new Date(start);
  windowStart.setMonth(windowStart.getMonth() + (monthsElapsed ?? 0));
  const windowEnd = new Date(windowStart);
  windowEnd.setMonth(windowEnd.getMonth() + 1);

  const span = windowEnd.getTime() - windowStart.getTime();
  if (span <= 0) return 0;
  const through = (now.getTime() - windowStart.getTime()) / span;
  return Math.min(1, Math.max(0, through));
}

/** The columns every person-shaped response selects. No email, ever. */
const PERSON_COLUMNS = `
  u.id                as account_id,
  u.display_name,
  u.image_url,
  p.handle,
  p.show_on_wall,
  p.main_project_name,
  p.main_project_url,
  p.github_login
`;

function toPerson(row) {
  return {
    accountId: row.account_id,
    handle: displayHandle(row),
    displayName: row.display_name ?? null,
    imageUrl: row.image_url ?? null,
    project: row.main_project_name
      ? { name: row.main_project_name, url: row.main_project_url ?? undefined }
      : null,
  };
}

/* ========================================================================== */
/* the points ledger                                                          */
/* ========================================================================== */

/**
 * Write one award. Returns true only if it was actually new.
 *
 * `ON CONFLICT DO NOTHING` with no target swallows any unique violation, which
 * is precisely the partial index on (account_id, kind, ref_id). So calling this
 * twice with the same ref is free, and two callers racing cannot both win.
 */
export async function award(client, { accountId, kind, points, refId = null }) {
  if (!points) return false;
  const written = await client.query(
    `insert into afs.point_events (account_id, kind, points, ref_id)
     values ($1, $2, $3, $4)
     on conflict do nothing
     returning id`,
    [accountId, kind, points, refId],
  );
  return written.rowCount > 0;
}

/**
 * The current unbroken run of days with at least one contribution.
 *
 * Today not being shipped yet does NOT break the streak — it is 9am somewhere
 * and the day is not over. The run is allowed to end today or yesterday.
 */
export async function computeStreak(client, accountId) {
  const days = await client.query(
    `select date, contributions
       from afs.ship_days
      where account_id = $1 and contributions > 0
      order by date desc
      limit 400`,
    [accountId],
  );
  if (days.rowCount === 0) return { streak: 0, shippedToday: false };

  const isoOf = (value) =>
    (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
  const shipped = days.rows.map((row) => isoOf(row.date));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const yesterday = new Date(today);
  yesterday.setUTCDate(today.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const shippedToday = shipped[0] === todayIso;
  if (!shippedToday && shipped[0] !== yesterdayIso) {
    // the most recent ship is older than yesterday, so nothing is running
    return { streak: 0, shippedToday: false };
  }

  // walk backwards one day at a time for as long as the set is contiguous
  const set = new Set(shipped);
  const cursor = new Date(shippedToday ? today : yesterday);
  let streak = 0;
  for (;;) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!set.has(iso)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { streak, shippedToday };
}

/**
 * Pay for every completed week of an unbroken run: day 7, day 14, day 21 and
 * so on, 25 points each.
 *
 * The ref is the day the block completed, so each week is paid exactly once
 * ever. That does mean a member who reaches day 21, lapses, and later climbs
 * back to day 21 is not paid twice for it — the alternative is paying
 * repeatedly for the same milestone by breaking a streak on purpose.
 */
async function awardStreakWeeks(
  client,
  accountId,
  streak,
  { notBeforeIso = null, shippedToday = true } = {},
) {
  let paid = 0;
  // the run ends today (or yesterday if today is not shipped yet);
  // milestone N was reached (streak - N) days before that
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  if (!shippedToday) end.setUTCDate(end.getUTCDate() - 1);
  for (let day = 7; day <= streak; day += 7) {
    if (notBeforeIso) {
      const reached = new Date(end);
      reached.setUTCDate(end.getUTCDate() - (streak - day));
      if (reached.toISOString().slice(0, 10) < notBeforeIso) continue; // history
    }
    const isNew = await award(client, {
      accountId,
      kind: "streak",
      points: POINTS.streak7,
      refId: `streak_${day}`,
    });
    if (isNew) paid += POINTS.streak7;
  }
  return paid;
}

/**
 * Rebuild one person's rollup from the ledger. Cheap, and always agrees with
 * the ledger, which is what makes the ledger the single source of truth.
 *
 * rank_month is left alone here: a rank is relative to everybody else, so it
 * belongs to recomputeRanks().
 */
export async function recomputeStats(client, accountId) {
  const totals = await client.query(
    `select
       coalesce(sum(points), 0)::int as points_all,
       coalesce(sum(points) filter (
         where created_at >= date_trunc('month', now())
       ), 0)::int as points_month
     from afs.point_events
     where account_id = $1`,
    [accountId],
  );

  const { streak } = await computeStreak(client, accountId);
  const pointsAll = totals.rows[0].points_all;
  const pointsMonth = totals.rows[0].points_month;
  const level = levelForPoints(pointsAll);

  const saved = await client.query(
    `insert into afs.member_stats
       (account_id, points_all, points_month, level, streak, best_streak, updated_at)
     values ($1, $2, $3, $4, $5, $5, now())
     on conflict (account_id) do update
       set points_all   = excluded.points_all,
           points_month = excluded.points_month,
           level        = excluded.level,
           streak       = excluded.streak,
           -- a best streak is a record: it only ever goes up
           best_streak  = greatest(afs.member_stats.best_streak, excluded.streak),
           updated_at   = now()
     returning points_all, points_month, level, streak, best_streak`,
    [accountId, pointsAll, pointsMonth, level, streak],
  );
  return saved.rows[0];
}

/**
 * Refresh everyone's monthly rank. Ties share a rank (rank(), not row_number())
 * because two people on the same points are genuinely level.
 */
export async function recomputeRanks(client = postgres) {
  const updated = await client.query(
    `with ranked as (
       select s.account_id,
              rank() over (order by s.points_month desc, s.points_all desc) as position
         from afs.member_stats s
         join afs.profiles p on p.account_id = s.account_id
        where s.points_month > 0 and p.show_on_wall = true
     )
     update afs.member_stats s
        set rank_month = ranked.position
       from ranked
      where ranked.account_id = s.account_id
        and (s.rank_month is distinct from ranked.position)`,
  );
  return updated.rowCount;
}

/* ========================================================================== */
/* GitHub — day counts only                                                    */
/* ========================================================================== */

const GITHUB_CONTRIBUTIONS_QUERY = `
  query($from: DateTime!, $to: DateTime!) {
    viewer {
      login
      databaseId
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

/**
 * Read the member's contribution calendar.
 *
 * Note what this asks GitHub for: a date and a count, and nothing else. No
 * repository names, no commit messages, no diffs — the plan is explicit that
 * only day-level counts may be stored, and the simplest way to honour that is
 * to never fetch anything more.
 *
 * GitHub caps contributionsCollection at one year per call, which is also
 * exactly what the heatmap draws.
 */
export async function fetchContributionCalendar(githubToken) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCFullYear(to.getUTCFullYear() - 1);
  from.setUTCDate(from.getUTCDate() + 1);

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "aiforsavages-hub",
    },
    body: JSON.stringify({
      query: GITHUB_CONTRIBUTIONS_QUERY,
      variables: { from: from.toISOString(), to: to.toISOString() },
    }),
  });

  if (!response.ok) {
    throw new Error(`github_http_${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`github_graphql: ${payload.errors[0]?.type ?? "error"}`);
  }

  const viewer = payload.data?.viewer;
  if (!viewer) throw new Error("github_no_viewer");

  const days = [];
  const weeks =
    viewer.contributionsCollection?.contributionCalendar?.weeks ?? [];
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      days.push({ date: day.date, contributions: day.contributionCount ?? 0 });
    }
  }

  return {
    login: viewer.login,
    githubUserId: viewer.databaseId != null ? String(viewer.databaseId) : null,
    days,
  };
}

/**
 * Store a calendar and pay for it: one ship award per day shipped, plus any
 * streak milestone that run has newly reached.
 *
 * Safe to run as often as you like. Every award is keyed on the day, so a
 * re-sync of the same year pays nothing the second time.
 *
 * NO RETROACTIVE POINTS (design plan §6.3, decision 4): the whole year fills
 * the heatmap, but only days from the day GitHub was connected earn anything.
 * Otherwise a year of daily commits would connect and land at ~5,000 points
 * and #1 for the month in one click. Streak milestones follow the same rule:
 * a milestone is paid only if the day it was reached is on or after connect.
 */
export async function applyContributionCalendar(accountId, calendar) {
  return withTransaction((client) =>
    applyContributionCalendarWithin(client, accountId, calendar),
  );
}

/** The body of applyContributionCalendar, inside a caller-owned transaction. */
export async function applyContributionCalendarWithin(client, accountId, calendar) {
  {
    if (calendar.githubUserId) {
      // A GitHub account may only ever be attached to one person. Someone
      // else's contributions must not be claimable by connecting their repo.
      const taken = await client.query(
        `select account_id from afs.profiles
          where github_user_id = $1 and account_id <> $2`,
        [calendar.githubUserId, accountId],
      );
      if (taken.rows[0]) {
        return { ok: false, reason: "github_already_linked" };
      }
    }

    const connected = await client.query(
      `insert into afs.profiles
         (account_id, github_login, github_user_id, github_connected_at)
       values ($1, $2, $3, now())
       on conflict (account_id) do update
         set github_login        = excluded.github_login,
             github_user_id      = excluded.github_user_id,
             github_connected_at = coalesce(
               afs.profiles.github_connected_at, excluded.github_connected_at),
             updated_at          = now()
       returning github_connected_at`,
      [accountId, calendar.login ?? null, calendar.githubUserId],
    );
    // the day they connected, as a calendar date — days before it are history
    const connectedIso = new Date(connected.rows[0].github_connected_at)
      .toISOString()
      .slice(0, 10);

    const shipped = calendar.days.filter((day) => day.contributions > 0);
    const payable = shipped.filter((day) => day.date >= connectedIso);

    if (calendar.days.length) {
      // One statement for the whole year rather than 365 round trips.
      await client.query(
        `insert into afs.ship_days (account_id, date, contributions)
         select $1, d.date::date, d.contributions
           from jsonb_to_recordset($2::jsonb) as d(date text, contributions int)
         on conflict (account_id, date) do update
           set contributions = excluded.contributions`,
        [accountId, JSON.stringify(calendar.days)],
      );
    }

    let awarded = 0;
    for (const day of payable) {
      const isNew = await award(client, {
        accountId,
        kind: "ship",
        points: POINTS.ship,
        refId: day.date,
      });
      if (isNew) awarded += POINTS.ship;
    }

    const { streak, shippedToday } = await computeStreak(client, accountId);
    awarded += await awardStreakWeeks(client, accountId, streak, {
      notBeforeIso: connectedIso,
      shippedToday,
    });

    const stats = await recomputeStats(client, accountId);
    return {
      ok: true,
      daysStored: calendar.days.length,
      daysShipped: shipped.length,
      pointsAwarded: awarded,
      streak,
      shippedToday,
      stats,
    };
  }
}

/** Has this person connected GitHub? */
export async function githubStatus(accountId) {
  const found = await postgres.query(
    `select github_login, github_connected_at, (github_token_enc is not null) as has_token
       from afs.profiles where account_id = $1`,
    [accountId],
  );
  const row = found.rows[0];
  return {
    // "connected" means the Hub holds a token it can sync with. A person who
    // disconnected keeps their history and connect date but is not connected.
    connected: row?.has_token === true,
    login: row?.github_login ?? null,
    connectedAt: row?.github_connected_at ?? null,
  };
}

/* ========================================================================== */
/* GitHub — the token itself                                                   */
/* ========================================================================== */

/**
 * The member's stored GitHub token, for a sync.
 *
 * Shape matches the old login-provider lookup so the sync route did not have
 * to change: { ok, token } or { ok: false, reason }.
 */
export async function githubTokenFor(accountId) {
  if (!githubTokenConfigured()) return { ok: false, reason: "github_not_configured" };
  const found = await postgres.query(
    `select github_token_enc from afs.profiles where account_id = $1`,
    [accountId],
  );
  const blob = found.rows[0]?.github_token_enc;
  if (!blob) return { ok: false, reason: "github_not_connected" };
  try {
    const token = openToken(blob);
    return token ? { ok: true, token } : { ok: false, reason: "github_not_connected" };
  } catch {
    // sealed under a different key than the one we run with: treat as not
    // connected rather than crashing every sync for this person
    return { ok: false, reason: "github_token_unreadable" };
  }
}

/**
 * Connect GitHub: the site finished the OAuth dance and hands over the token.
 *
 * The token is proven before it is kept — one calendar read, which also tells
 * us who this is on GitHub. Then the same one-account-per-person rule and the
 * same no-retroactive-points rule as every later sync apply, and only if all
 * of that went through is the token sealed and stored, in the same
 * transaction. A token that fails validation is never written anywhere.
 */
export async function connectGithub(
  accountId,
  token,
  { fetchCalendar = fetchContributionCalendar } = {},
) {
  if (!githubTokenConfigured()) return { ok: false, reason: "github_not_configured" };
  if (typeof token !== "string" || token.length < 8 || token.length > 512) {
    return { ok: false, reason: "github_token_invalid" };
  }

  let calendar;
  try {
    calendar = await fetchCalendar(token);
  } catch (error) {
    const message = String(error?.message ?? "");
    // 401 = GitHub rejected the token; anything else is GitHub being down
    return {
      ok: false,
      reason: message.includes("github_http_401") ? "github_token_invalid" : "github_unavailable",
    };
  }
  if (!calendar?.githubUserId) return { ok: false, reason: "github_token_invalid" };

  const sealed = sealToken(token);
  return withTransaction(async (client) => {
    const applied = await applyContributionCalendarWithin(client, accountId, calendar);
    if (!applied.ok) return applied;
    await client.query(
      `update afs.profiles set github_token_enc = $2, updated_at = now()
        where account_id = $1`,
      [accountId, sealed],
    );
    return { ...applied, login: calendar.login ?? null };
  });
}

/**
 * Disconnect: forget the token and the GitHub identity. The heatmap history,
 * the points already earned and the original connect date all stay — points
 * are never clawed back, and reconnecting later must not restart the
 * no-retroactive-points window from scratch.
 */
export async function disconnectGithub(accountId) {
  const updated = await postgres.query(
    `update afs.profiles
        set github_token_enc = null,
            github_login     = null,
            github_user_id   = null,
            updated_at       = now()
      where account_id = $1
      returning account_id`,
    [accountId],
  );
  return { ok: true, wasConnected: updated.rowCount > 0 };
}

/* ========================================================================== */
/* heatmaps                                                                    */
/* ========================================================================== */

/**
 * A year of day counts as { 'YYYY-MM-DD': n }, which is the shape the heatmap
 * component already expects from the sample data.
 */
export async function heatmapFor(accountId, days = 371) {
  const rows = await postgres.query(
    `select date, contributions
       from afs.ship_days
      where account_id = $1
        and date >= (current_date - ($2::int - 1))
      order by date`,
    [accountId, days],
  );
  const calendar = {};
  for (const row of rows.rows) {
    const iso =
      row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10);
    calendar[iso] = row.contributions;
  }
  return calendar;
}

/** Several people's heatmaps in one query, for the rankings list. */
export async function heatmapsFor(accountIds, days = 371) {
  if (!accountIds.length) return {};
  const rows = await postgres.query(
    `select account_id, date, contributions
       from afs.ship_days
      where account_id = any($1::uuid[])
        and date >= (current_date - ($2::int - 1))
      order by date`,
    [accountIds, days],
  );
  const byAccount = {};
  for (const row of rows.rows) {
    const iso =
      row.date instanceof Date
        ? row.date.toISOString().slice(0, 10)
        : String(row.date).slice(0, 10);
    (byAccount[row.account_id] ??= {})[iso] = row.contributions;
  }
  return byAccount;
}

/* ========================================================================== */
/* the Wall                                                                    */
/* ========================================================================== */

const POST_TYPES = new Set(["build", "content"]);
const VISIBILITIES = new Set(["public", "members"]);

function cleanUrl(value, { max = 500 } = {}) {
  if (!value) return null;
  const url = String(value).trim();
  if (!url) return null;
  // http/https only, re-checked here and never trusted from the browser
  if (!/^https?:\/\//i.test(url)) return { error: "invalid_url" };
  if (url.length > max) return { error: "url_too_long" };
  return url;
}

export async function createPost(accountId, input) {
  const type = String(input?.type ?? "").toLowerCase();
  if (!POST_TYPES.has(type)) return { ok: false, reason: "invalid_type" };

  const title = String(input?.title ?? "").trim().slice(0, 140);
  if (title.length < 3) return { ok: false, reason: "title_too_short" };

  const caption = input?.caption ? String(input.caption).trim().slice(0, 600) : null;

  const visibility = String(input?.visibility ?? "public").toLowerCase();
  if (!VISIBILITIES.has(visibility)) return { ok: false, reason: "invalid_visibility" };

  for (const field of ["mediaUrl", "thumbUrl", "linkUrl"]) {
    const checked = cleanUrl(input?.[field]);
    if (checked && typeof checked === "object") {
      return { ok: false, reason: `${field}_${checked.error}` };
    }
  }

  const madeWith = Array.isArray(input?.madeWith)
    ? input.madeWith.map((value) => String(value).trim().slice(0, 60)).filter(Boolean).slice(0, 6)
    : null;

  return withTransaction(async (client) => {
    // A hard ceiling on posting, separate from what earns points.
    const postedToday = await client.query(
      `select count(*)::int as n from afs.wall_posts
        where account_id = $1 and created_at >= date_trunc('day', now())`,
      [accountId],
    );
    if (postedToday.rows[0].n >= POSTS_PER_DAY) {
      return { ok: false, reason: "daily_post_limit" };
    }

    const created = await client.query(
      `insert into afs.wall_posts
         (account_id, type, title, caption, media_kind, media_url, thumb_url,
          link_url, link_provider, aspect, made_with, visibility)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning id, created_at`,
      [
        accountId,
        type,
        title,
        caption,
        input?.mediaKind ? String(input.mediaKind).slice(0, 20) : null,
        cleanUrl(input?.mediaUrl) || null,
        cleanUrl(input?.thumbUrl) || null,
        cleanUrl(input?.linkUrl) || null,
        input?.linkProvider ? String(input.linkProvider).slice(0, 40) : null,
        input?.aspect ? String(input.aspect).slice(0, 12) : null,
        madeWith,
        visibility,
      ],
    );
    const post = created.rows[0];

    // "First post each day" (design 6.1). Posting more is allowed up to the
    // daily limit, it just stops being worth points.
    const todayCount = await client.query(
      `select count(*)::int as n
         from afs.point_events
        where account_id = $1 and kind = 'post'
          and created_at >= date_trunc('day', now())`,
      [accountId],
    );
    if (todayCount.rows[0].n < SCORING_POSTS_PER_DAY) {
      await award(client, {
        accountId,
        kind: "post",
        points: POINTS.post,
        refId: post.id,
      });
    }

    const stats = await recomputeStats(client, accountId);
    return { ok: true, postId: post.id, createdAt: post.created_at, stats };
  });
}

/**
 * Toggle 🔥 on a post.
 *
 * The author is paid once per person who fires it, and unfiring does not claw
 * the point back — otherwise a reaction becomes a lever someone can use to
 * yank another member's score up and down. The refId keeps it to one payment
 * per (post, reactor) pair for good.
 *
 * Nobody earns anything for firing their own post.
 */
export async function toggleFire(viewerAccountId, postId) {
  return withTransaction(async (client) => {
    // `for update` is load-bearing. Without it, three people firing the same
    // post at once each recount from their own snapshot and the last writer
    // wins with a number that is too low. Taking the post's row lock first
    // makes the whole toggle atomic per post, and only per post, so reactions
    // to different posts never wait on each other.
    const post = await client.query(
      `select id, account_id from afs.wall_posts
        where id = $1 and hidden_at is null
        for update`,
      [postId],
    );
    if (!post.rows[0]) return { ok: false, reason: "post_not_found" };
    const authorId = post.rows[0].account_id;

    const removed = await client.query(
      `delete from afs.wall_reactions
        where post_id = $1 and account_id = $2
        returning post_id`,
      [postId, viewerAccountId],
    );

    let fired;
    if (removed.rowCount > 0) {
      fired = false;
    } else {
      await client.query(
        `insert into afs.wall_reactions (post_id, account_id) values ($1, $2)
         on conflict do nothing`,
        [postId, viewerAccountId],
      );
      fired = true;

      if (authorId !== viewerAccountId) {
        // "up to +20 a post" (design 6.1): a viral post stops paying past the
        // cap, so one hit cannot dominate the leaderboard.
        const alreadyPaid = await client.query(
          `select count(*)::int as n from afs.point_events
            where kind = 'fire' and ref_id like $1`,
          [`${postId}:%`],
        );
        if (alreadyPaid.rows[0].n < FIRE_CAP_PER_POST) {
          await award(client, {
            accountId: authorId,
            kind: "fire",
            points: POINTS.fire,
            refId: `${postId}:${viewerAccountId}`,
          });
        }
      }
    }

    // Recount rather than increment: the count then cannot drift from the rows.
    const counted = await client.query(
      `update afs.wall_posts
          set fire_count = (
            select count(*) from afs.wall_reactions where post_id = $1
          )
        where id = $1
        returning fire_count`,
      [postId],
    );

    if (authorId !== viewerAccountId) await recomputeStats(client, authorId);

    return { ok: true, fired, fireCount: counted.rows[0].fire_count };
  });
}

export async function reportPost(reporterAccountId, postId, reason) {
  const exists = await postgres.query(
    `select id from afs.wall_posts where id = $1`,
    [postId],
  );
  if (!exists.rows[0]) return { ok: false, reason: "post_not_found" };

  await postgres.query(
    `insert into afs.wall_reports (post_id, reporter_account_id, reason)
     values ($1, $2, $3)`,
    [postId, reporterAccountId, reason ? String(reason).slice(0, 300) : null],
  );
  return { ok: true };
}

/** An author hiding their own post. Soft delete: reactions and points stand. */
export async function hideOwnPost(accountId, postId) {
  const hidden = await postgres.query(
    `update afs.wall_posts set hidden_at = now()
      where id = $1 and account_id = $2 and hidden_at is null
      returning id`,
    [postId, accountId],
  );
  return hidden.rowCount > 0
    ? { ok: true }
    : { ok: false, reason: "not_your_post" };
}

/**
 * The Wall feed.
 *
 * `members`-only posts are withheld from anyone who is not a member, which is
 * decided by the caller passing viewerIsMember — the Hub has already
 * established that from core.has_membership, so the browser cannot claim it.
 */
export async function wallFeed({
  viewerAccountId = null,
  viewerIsMember = false,
  filter = "all",
  sort = "new",
  limit = 24,
  cursor = null,
} = {}) {
  const conditions = ["w.hidden_at is null"];
  const values = [];

  if (!viewerIsMember) conditions.push("w.visibility = 'public'");

  if (filter === "build" || filter === "content") {
    values.push(filter);
    conditions.push(`w.type = $${values.length}`);
  } else if (filter === "picks") {
    conditions.push("w.is_pick = true");
  } else if (filter === "mine") {
    if (!viewerAccountId) return { posts: [], nextCursor: null };
    values.push(viewerAccountId);
    conditions.push(`w.account_id = $${values.length}`);
  }

  // Keyset pagination, not OFFSET: the feed keeps growing at the top, and
  // OFFSET would show people duplicates as it shifts under them.
  const orderBy =
    sort === "fire"
      ? "w.fire_count desc, w.created_at desc, w.id desc"
      : "w.created_at desc, w.id desc";

  if (cursor) {
    const [cursorValue, cursorId] = String(cursor).split("|");
    if (cursorValue && cursorId) {
      if (sort === "fire") {
        values.push(Number(cursorValue), cursorId);
        conditions.push(
          `(w.fire_count, w.id) < ($${values.length - 1}::int, $${values.length}::uuid)`,
        );
      } else {
        values.push(cursorValue, cursorId);
        conditions.push(
          `(w.created_at, w.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
    }
  }

  values.push(Math.min(Math.max(Number(limit) || 24, 1), 60));
  const limitPlaceholder = `$${values.length}`;

  values.push(viewerAccountId);
  const viewerPlaceholder = `$${values.length}`;

  const rows = await postgres.query(
    `select w.id, w.type, w.title, w.caption, w.media_kind, w.media_url,
            w.thumb_url, w.link_url, w.link_provider, w.aspect, w.made_with,
            w.visibility, w.is_pick, w.fire_count, w.created_at,
            ${PERSON_COLUMNS},
            (${viewerPlaceholder}::uuid is not null and exists (
               select 1 from afs.wall_reactions r
                where r.post_id = w.id and r.account_id = ${viewerPlaceholder}::uuid
             )) as fired_by_viewer,
            coalesce(st.level, 1) as author_level,
            coalesce(st.streak, 0) as author_streak
       from afs.wall_posts w
       join public.app_users u on u.id = w.account_id
       left join afs.profiles p on p.account_id = w.account_id
       left join afs.member_stats st on st.account_id = w.account_id
      where ${conditions.join(" and ")}
      order by ${orderBy}
      limit ${limitPlaceholder}`,
    values,
  );

  const posts = rows.rows.map((row) => ({
    id: row.id,
    kind: row.type === "build" ? "Build" : "Content",
    type: row.type,
    title: row.title,
    caption: row.caption,
    mediaKind: row.media_kind,
    image: row.thumb_url ?? row.media_url ?? null,
    mediaUrl: row.media_url,
    linkUrl: row.link_url,
    linkProvider: row.link_provider,
    aspect: row.aspect ?? "4 / 5",
    madeWith: row.made_with?.[0] ?? null,
    madeWithAll: row.made_with ?? [],
    visibility: row.visibility,
    isPick: row.is_pick,
    isVideo: row.media_kind === "video",
    fire: row.fire_count,
    firedByViewer: row.fired_by_viewer === true,
    createdAt: row.created_at,
    author: { ...toPerson(row), level: row.author_level, streak: row.author_streak },
    handle: displayHandle(row),
  }));

  const last = rows.rows[rows.rows.length - 1];
  const nextCursor =
    rows.rowCount === Number(values[values.length - 2]) && last
      ? sort === "fire"
        ? `${last.fire_count}|${last.id}`
        : `${new Date(last.created_at).toISOString()}|${last.id}`
      : null;

  // Each tile draws its author's last 12 weeks of shipping. Fetched here for
  // the whole page in one query rather than letting the browser make a request
  // per post, and trimmed to the 84 days the mini heatmap actually renders.
  const authorIds = [...new Set(rows.rows.map((row) => row.account_id))];
  const heatmaps = await heatmapsFor(authorIds, 84);

  return { posts, nextCursor, heatmaps };
}

/* ========================================================================== */
/* rankings and community totals                                               */
/* ========================================================================== */

/**
 * The leaderboard. `range` is 'month' or 'all'.
 *
 * People who turned off show_on_wall are left out: being ranked in public is
 * passive, so it is the thing an opt-out should switch off. Posting, by
 * contrast, is a deliberate act, so their posts stay on the Wall.
 */
export async function rankings({
  range = "month",
  viewerAccountId = null,
  limit = 50,
  withHeatmaps = true,
} = {}) {
  const orderColumn = range === "all" ? "s.points_all" : "s.points_month";
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const rows = await postgres.query(
    `select ${PERSON_COLUMNS},
            s.points_all, s.points_month, s.level, s.streak, s.best_streak,
            rank() over (order by ${orderColumn} desc, s.points_all desc) as position,
            m.member_since,
            (extract(year from age(now(), m.member_since)) * 12
             + extract(month from age(now(), m.member_since)))::int as member_months,
            exists (
              select 1 from afs.ship_days d
               where d.account_id = u.id and d.date = current_date
                 and d.contributions > 0
            ) as shipped_today,
            (select count(*)::int from afs.ship_days d
              where d.account_id = u.id and d.contributions > 0
                and d.date >= current_date - 29) as ship_days_30
       from afs.member_stats s
       join public.app_users u on u.id = s.account_id
       left join afs.profiles p on p.account_id = s.account_id
       left join core.memberships m
              on m.account_id = s.account_id
             and m.product_id = 'aiforsavages'
             and m.status in ('active','past_due')
      where coalesce(p.show_on_wall, true) = true
        and ${orderColumn} > 0
      order by ${orderColumn} desc, s.points_all desc
      limit $1`,
    [capped],
  );

  const heatmaps = withHeatmaps
    ? await heatmapsFor(rows.rows.map((row) => row.account_id))
    : {};

  const builders = rows.rows.map((row) => ({
    rank: Number(row.position),
    ...toPerson(row),
    points: row.points_month,
    pointsAll: row.points_all,
    level: row.level,
    streak: row.streak,
    bestStreak: row.best_streak,
    shippedToday: row.shipped_today === true,
    shipDays: row.ship_days_30,
    memberMonths: row.member_months ?? 0,
    memberProgress: memberProgressFrom(row.member_since, row.member_months),
    isYou: viewerAccountId != null && row.account_id === viewerAccountId,
    heatmap: heatmaps[row.account_id] ?? {},
  }));

  return { range, builders };
}

/** The numbers above the Wall. */
export async function communityTotals() {
  const totals = await postgres.query(
    `select
       (select count(*)::int from afs.ship_days
         where date >= date_trunc('month', current_date)
           and contributions > 0) as ships_month,
       (select count(*)::int from afs.ship_days
         where date = current_date and contributions > 0) as shipped_today,
       (select count(*)::int from afs.member_stats
         where points_all > 0) as builders,
       (select count(*)::int from afs.wall_posts
         where hidden_at is null) as posts`,
  );
  return totals.rows[0];
}

/** The signed-in member's own dashboard. */
export async function dashboardFor(accountId) {
  const [stats, person, calendar, totals] = await Promise.all([
    postgres.query(
      `select points_all, points_month, level, streak, best_streak, rank_month
         from afs.member_stats where account_id = $1`,
      [accountId],
    ),
    postgres.query(
      `select ${PERSON_COLUMNS} from public.app_users u
         left join afs.profiles p on p.account_id = u.id
        where u.id = $1`,
      [accountId],
    ),
    heatmapFor(accountId),
    communityTotals(),
  ]);

  const row = stats.rows[0] ?? {
    points_all: 0,
    points_month: 0,
    level: 1,
    streak: 0,
    best_streak: 0,
    rank_month: null,
  };

  const weekPoints = await postgres.query(
    `select coalesce(sum(points), 0)::int as n
       from afs.point_events
      where account_id = $1 and created_at >= now() - interval '7 days'`,
    [accountId],
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    me: person.rows[0] ? toPerson(person.rows[0]) : null,
    github: await githubStatus(accountId),
    points: row.points_all,
    pointsMonth: row.points_month,
    ...levelProgress(row.points_all),
    streak: row.streak,
    bestStreak: row.best_streak,
    rank: row.rank_month,
    weekPoints: weekPoints.rows[0].n,
    shippedToday: (calendar[todayIso] ?? 0) > 0,
    heatmap: calendar,
    community: totals,
  };
}

/** The challenge running right now, if any. */
export async function currentChallenge() {
  const found = await postgres.query(
    `select id, title, starts_at, ends_at, winner_post_id
       from afs.challenges
      where starts_at <= now() and ends_at > now()
      order by starts_at desc
      limit 1`,
  );
  return found.rows[0] ?? null;
}
