-- Points for every post on a connected account, whichever app or tool made
-- it, from the day the account was first connected. Posts made through
-- Posterract keep earning as projections (post_points); the others earn here,
-- from the numbers each analytics refresh reads for them.

-- When the platform account was first connected. created_at can't say: a
-- workspace starts with an empty row per platform, filled in whenever the
-- account is connected. OAuth sets this from now on; for accounts connected
-- before, it is the first sign of the connection: its "connected" event, its
-- first post through Posterract, or its first stats read.
alter table social_accounts add column if not exists connected_at timestamptz;

update social_accounts a
set connected_at = greatest(a.created_at, least(
  (select min(e.occurred_at) from events e
   where e.workspace_id = a.workspace_id and e.type = 'portal.connected'
     and (e.payload->>'socialAccountId' = a.id::text
          or e.message = a.provider || ' connected — ' || a.handle)),
  (select min(p.created_at) from projections p where p.social_account_id = a.id),
  (select min(r.started_at) from analytics_sync_runs r where r.social_account_id = a.id),
  (select min(s.fetched_at) from account_metric_snapshots s where s.social_account_id = a.id)
))
where a.connected_at is null and a.provider_account_id is not null;

-- A post made elsewhere: its caption (the feed's title) and its latest numbers.
alter table platform_posts add column if not exists caption text;
alter table platform_posts add column if not exists views bigint;
alter table platform_posts add column if not exists likes bigint;
alter table platform_posts add column if not exists comments bigint;
alter table platform_posts add column if not exists shares bigint;
alter table platform_posts add column if not exists watch_time_seconds numeric;
alter table platform_posts add column if not exists average_view_duration_seconds numeric;
alter table platform_posts add column if not exists duration_seconds numeric;
alter table platform_posts add column if not exists thumbnail_url text;
alter table platform_posts add column if not exists raw_metrics jsonb;
alter table platform_posts add column if not exists metrics_fetched_at timestamptz;

-- What each rule of a post made elsewhere has earned, like post_points. Keyed
-- by the platform's own post ID rather than the account row, so a post two of
-- the workspace's account rows list is paid once.
create table if not exists platform_post_points (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  platform_post_id text not null,
  source text not null,
  social_account_id uuid references social_accounts(id) on delete set null,
  points numeric(14, 2) not null default 0,
  metric_value numeric,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider, platform_post_id, source)
);

alter table points_ledger add column if not exists platform_post_id text;

create index if not exists points_ledger_platform_post_idx
  on points_ledger (workspace_id, provider, platform_post_id)
  where platform_post_id is not null;
