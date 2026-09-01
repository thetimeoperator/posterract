-- Multiple social accounts per provider and reusable named account sets.
-- A workspace may connect up to ten accounts for each provider; the cap is
-- enforced transactionally by the API so reconnecting an existing account is
-- still possible at the limit.

drop index if exists social_accounts_one_provider_per_workspace_idx;

alter table social_accounts
  drop constraint if exists social_accounts_provider_provider_account_id_key;

create unique index if not exists social_accounts_workspace_provider_account_idx
  on social_accounts(workspace_id, provider, provider_account_id);

create index if not exists social_accounts_workspace_provider_status_idx
  on social_accounts(workspace_id, provider, status, created_at);

create table if not exists account_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_sets_workspace_name_idx
  on account_sets(workspace_id, lower(name));

create index if not exists account_sets_workspace_updated_idx
  on account_sets(workspace_id, updated_at desc);

create table if not exists account_set_members (
  account_set_id uuid not null references account_sets(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  provider text not null check (
    provider in ('instagram', 'tiktok', 'facebook', 'threads', 'x', 'youtube')
  ),
  created_at timestamptz not null default now(),
  primary key (account_set_id, social_account_id),
  unique (account_set_id, provider)
);

create index if not exists account_set_members_account_idx
  on account_set_members(social_account_id);
