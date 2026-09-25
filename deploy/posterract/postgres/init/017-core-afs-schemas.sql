-- 017-core-afs-schemas.sql
--
-- Shared identity + membership layer (schema `core`) and AI FOR SAVAGES
-- feature tables (schema `afs`). Posterract's existing `public` tables are
-- not touched.
--
-- Direction of dependency is one-way on purpose: core/afs reference
-- public.app_users, but nothing in public references core/afs, so Posterract
-- keeps working even if these schemas were dropped.
--
-- The `hub` role is created NOLOGIN with no password. Granting it a password
-- is a separate operational step so no secret ever lives in this repo:
--     alter role hub with login password '<from /srv/posterract/.env>';

create schema if not exists core;
create schema if not exists afs;

-- ---------------------------------------------------------------- products

create table if not exists core.products (
  id               text primary key,
  name             text not null,
  -- true = an active AI FOR SAVAGES membership includes this product's base plan
  member_base_plan boolean not null default false,
  created_at       timestamptz not null default now()
);

insert into core.products (id, name, member_base_plan) values
  ('aiforsavages', 'AI FOR SAVAGES', false),
  ('posterract',   'Posterract',     true)
on conflict (id) do nothing;

-- -------------------------------------------------------------- identities
-- A login attached to a person. Clerk today; any provider later.

create table if not exists core.identities (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.app_users(id) on delete cascade,
  provider         text not null check (provider in ('clerk')),
  provider_user_id text not null,
  email            text not null,          -- lower-cased, as verified at link time
  verified_at      timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint identities_provider_user_unique    unique (provider, provider_user_id),
  constraint identities_provider_account_unique unique (provider, account_id)
);

create index if not exists identities_account_idx on core.identities (account_id);
create index if not exists identities_email_idx   on core.identities (lower(email));

-- ------------------------------------------------------------- memberships
-- A person's subscription to a product billed per person (AI FOR SAVAGES).
-- Posterract's own per-workspace billing stays in public.billing_*.

create table if not exists core.memberships (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.app_users(id) on delete cascade,
  product_id             text not null references core.products(id),
  plan                   text not null check (plan   in ('founding','monthly','yearly','lifetime','comp')),
  status                 text not null check (status in ('active','past_due','canceled','expired','refunded')),
  source                 text not null check (source in ('legacy_one_time','stripe_subscription','stripe_one_time','manual')),
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  stripe_price_id        text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,      -- null = never expires (founding, lifetime, comp)
  cancel_at_period_end   boolean not null default false,
  -- first failure + 3 days; later retries of the same invoice must NOT extend it
  grace_until            timestamptz,
  -- start of the current UNBROKEN membership; drives the moon streak as months elapsed
  member_since           timestamptz not null default now(),
  ended_at               timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- at most one live membership per person per product
create unique index if not exists memberships_one_live_per_product
  on core.memberships (account_id, product_id)
  where status in ('active','past_due');

create index if not exists memberships_account_idx         on core.memberships (account_id);
create index if not exists memberships_stripe_customer_idx on core.memberships (stripe_customer_id);
create index if not exists memberships_grace_sweep_idx     on core.memberships (grace_until)
  where status = 'past_due';

-- ------------------------------------------------------------- THE rule
-- One function every product uses to answer "is this person a member?".
--   active   : the extra day is leeway for a late webhook
--   past_due : exactly 3 days of access after a card fails, then off,
--              even though Stripe keeps retrying for longer

create or replace function core.has_membership(account uuid, product text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from core.memberships m
    where m.account_id = account
      and m.product_id = product
      and (
            (    m.status = 'active'
             and (m.current_period_end is null
                  or m.current_period_end + interval '1 day' > now()))
         or (    m.status = 'past_due'
             and m.grace_until is not null
             and m.grace_until > now())
          )
  );
$$;

-- --------------------------------------------------------- billing ledger
-- Kept separate from Posterract's stripe_webhook_events so the two products
-- can never step on each other.

create table if not exists core.billing_events (
  stripe_event_id text primary key,
  type            text not null,
  livemode        boolean not null,
  payload_sha256  text,
  account_id      uuid references public.app_users(id) on delete set null,
  status          text not null check (status in ('processed','ignored')),
  received_at     timestamptz not null default now()
);

-- ------------------------------------------------------------ review queue

create table if not exists core.review_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  account_id  uuid references public.app_users(id) on delete set null,
  details     jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists review_queue_open_idx on core.review_queue (created_at desc)
  where resolved_at is null;

-- ----------------------------------------------------------------- discord
-- Created now so the schema is complete, but INERT: nothing reads or writes
-- these until the Discord phase, which is deliberately last and not started.

create table if not exists core.discord_links (
  account_id       uuid primary key references public.app_users(id) on delete cascade,
  discord_user_id  text unique not null,
  discord_username text,
  linked_at        timestamptz not null default now(),
  in_guild         boolean not null default false,
  role             text,
  last_synced_at   timestamptz
);

-- one-time snapshot of everyone in the server at debut; these people are
-- never removed and rows are never deleted
create table if not exists core.discord_grandfathered (
  discord_user_id text primary key,
  username        text,
  captured_at     timestamptz not null default now()
);

create table if not exists core.discord_actions (
  id              uuid primary key default gen_random_uuid(),
  discord_user_id text,
  account_id      uuid references public.app_users(id) on delete set null,
  action          text not null check (action in ('add','role_add','role_remove','kick','skip')),
  reason          text,
  mode            text not null check (mode in ('report','enforce')),
  ok              boolean,
  error           text,
  at              timestamptz not null default now()
);

-- =================================================================== afs
-- AI FOR SAVAGES feature tables (replaces Supabase).
-- Only day-level GitHub counts are stored — never repo names, commit
-- messages or code.

create table if not exists afs.profiles (
  account_id          uuid primary key references public.app_users(id) on delete cascade,
  handle              text unique,
  show_on_wall        boolean not null default true,
  main_project_name   text check (main_project_name is null or char_length(main_project_name) <= 40),
  main_project_url    text check (
                        main_project_url is null
                        or (char_length(main_project_url) <= 200
                            and main_project_url ~* '^https?://')
                      ),
  github_login        text,
  github_user_id      text unique,
  github_connected_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists afs.ship_days (
  account_id    uuid not null references public.app_users(id) on delete cascade,
  date          date not null,
  contributions integer not null default 0,
  primary key (account_id, date)
);

create table if not exists afs.point_events (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.app_users(id) on delete cascade,
  kind       text not null check (kind in ('ship','streak','post','fire','pick','challenge')),
  points     integer not null,
  ref_id     text,
  created_at timestamptz not null default now()
);

create index if not exists point_events_account_idx on afs.point_events (account_id, created_at desc);

create table if not exists afs.member_stats (
  account_id   uuid primary key references public.app_users(id) on delete cascade,
  points_all   integer not null default 0,
  points_month integer not null default 0,
  level        integer not null default 1,
  streak       integer not null default 0,
  best_streak  integer not null default 0,
  rank_month   integer,
  updated_at   timestamptz not null default now()
);

create table if not exists afs.wall_posts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.app_users(id) on delete cascade,
  type          text not null check (type in ('build','content')),
  title         text not null,
  caption       text,
  media_kind    text,
  media_url     text,
  thumb_url     text,
  link_url      text,
  link_provider text,
  aspect        text,
  made_with     text[],
  visibility    text not null default 'public' check (visibility in ('public','members')),
  is_pick       boolean not null default false,
  fire_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  hidden_at     timestamptz
);

create index if not exists wall_posts_feed_idx on afs.wall_posts (created_at desc)
  where hidden_at is null;
create index if not exists wall_posts_account_idx on afs.wall_posts (account_id, created_at desc);

create table if not exists afs.wall_reactions (
  post_id    uuid not null references afs.wall_posts(id) on delete cascade,
  account_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, account_id)
);

create table if not exists afs.wall_reports (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references afs.wall_posts(id) on delete cascade,
  reporter_account_id uuid references public.app_users(id) on delete set null,
  reason              text,
  created_at          timestamptz not null default now()
);

create table if not exists afs.challenges (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  winner_post_id uuid references afs.wall_posts(id) on delete set null
);

-- ============================================================== hub role
-- Least privilege: the Hub can work in core/afs and touch only the four
-- public tables it needs. It cannot read Posterract's OAuth tokens, API
-- keys or projects.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'hub') then
    create role hub nologin;
  end if;
end
$$;

grant usage on schema core, afs to hub;

grant select, insert, update, delete on all tables in schema core to hub;
grant select, insert, update, delete on all tables in schema afs  to hub;

alter default privileges in schema core grant select, insert, update, delete on tables to hub;
alter default privileges in schema afs  grant select, insert, update, delete on tables to hub;

grant execute on function core.has_membership(uuid, text) to hub;

grant usage on schema public to hub;
grant select, insert, update on
  public.app_users,
  public.workspaces,
  public.workspace_memberships,
  public.social_accounts
to hub;
