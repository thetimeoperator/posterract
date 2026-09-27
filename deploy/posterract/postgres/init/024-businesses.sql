-- Businesses: groups of connected accounts that a user creates ("Pissed Off
-- Sofia", "Client A"), each with an optional small round logo. They replace
-- account sets. Any accounts can go in, several on one platform, and one
-- account can be in several businesses. A post remembers the business it was
-- posted from, and posting to a business posts to every account in it, so a
-- post can go to two Instagram accounts at once.

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  logo bytea,
  logo_type text check (logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  logo_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((logo is null) = (logo_type is null) and (logo is null) = (logo_hash is null))
);

create unique index if not exists businesses_workspace_name_idx
  on businesses(workspace_id, lower(name));

create index if not exists businesses_workspace_idx
  on businesses(workspace_id, created_at);

create index if not exists businesses_logo_hash_idx
  on businesses(logo_hash) where logo_hash is not null;

create table if not exists business_accounts (
  business_id uuid not null references businesses(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (business_id, social_account_id)
);

create index if not exists business_accounts_account_idx
  on business_accounts(social_account_id);

alter table transmissions
  add column if not exists business_id uuid references businesses(id) on delete set null;

create index if not exists transmissions_business_idx
  on transmissions(business_id) where business_id is not null;

-- One platform post per account, not per platform.
drop index if exists projections_one_provider_per_transmission_idx;

create unique index if not exists projections_one_per_account_idx
  on projections(transmission_id, social_account_id);

-- Points for a business or a set of accounts.
create index if not exists points_ledger_account_time_idx
  on points_ledger(workspace_id, social_account_id, awarded_at);

-- Account sets were never used in production (0 rows on Sep 26 2026).
drop table if exists account_set_members;
drop table if exists account_sets;
