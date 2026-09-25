-- Points, levels and the leaderboard.
--
-- Points become decimal: 3,540 Instagram views are 3.54 points. A post keeps
-- what it has earned rule by rule in post_points, which only ever grows, and
-- every increase is also written to the ledger, which totals, weeks, months
-- and the leaderboard are summed from. Follower milestones count growth from
-- the followers an account had on launch day, or when it was connected if
-- that came later, kept in follower_baselines. A workspace's time zone decides where its streak days
-- start and end.
--
-- This is the relaunch: the points paid under the old rules (10 per post) are
-- deleted and everyone starts at zero. Points count again from launch day,
-- POINTS_START_AT in @posterract/contract.

delete from points_ledger;

alter table points_ledger
  alter column amount type numeric(14, 2) using amount::numeric(14, 2);

alter table points_ledger
  add column if not exists projection_id uuid references projections(id) on delete set null;

alter table points_ledger
  add column if not exists social_account_id uuid references social_accounts(id) on delete set null;

alter table points_ledger
  add column if not exists provider text;

create index if not exists points_ledger_workspace_awarded_idx
  on points_ledger (workspace_id, awarded_at desc);

create index if not exists points_ledger_awarded_idx
  on points_ledger (awarded_at);

create table if not exists post_points (
  projection_id uuid not null references projections(id) on delete cascade,
  source text not null,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid references social_accounts(id) on delete set null,
  provider text not null,
  points numeric(14, 2) not null default 0,
  metric_value numeric,
  updated_at timestamptz not null default now(),
  primary key (projection_id, source)
);

create index if not exists post_points_workspace_idx on post_points (workspace_id);

create table if not exists follower_baselines (
  social_account_id uuid primary key references social_accounts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  followers bigint not null,
  observed_at timestamptz not null default now()
);

alter table workspaces
  add column if not exists time_zone text;
