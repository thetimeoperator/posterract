-- PostgreSQL cutover tables that are intentionally absent from the original
-- infrastructure bootstrap. This migration is idempotent so it can be run on
-- both the empty VPS database and a fresh local database.

create table if not exists schema_migrations (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

alter table app_users
  add column if not exists auth_user_id text unique;

alter table app_users
  add column if not exists email_verified boolean not null default false;

alter table app_users
  add column if not exists image_url text;

create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

insert into workspace_memberships (workspace_id, user_id, role)
select id, owner_id, 'owner'
from workspaces
where owner_id is not null
on conflict (workspace_id, user_id) do update set role = 'owner';

alter table social_accounts
  add column if not exists avatar_url text;

alter table social_accounts
  add column if not exists provider_auth_user_id text;

alter table social_accounts
  add column if not exists metadata jsonb not null default '{}';

alter table social_accounts
  add column if not exists last_health_check_at timestamptz;

alter table social_account_tokens
  add column if not exists access_token_expires_at timestamptz;

alter table social_account_tokens
  add column if not exists provider_auth_user_id text;

alter table oauth_states
  add column if not exists redirect_uri text;

alter table oauth_states
  add column if not exists code_verifier_ciphertext bytea;

alter table oauth_states
  add column if not exists consumed_at timestamptz;

alter table projections
  add column if not exists platform_media_id text;

alter table projections
  add column if not exists published_at timestamptz;

alter table projections
  add column if not exists canceled_at timestamptz;

alter table projections
  drop constraint if exists projections_status_check;

alter table projections
  add constraint projections_status_check check (
    status in (
      'pending', 'scheduled', 'uploading', 'publishing', 'processing',
      'live', 'failed', 'retrying', 'needs_reauth', 'blocked', 'canceled'
    )
  );

alter table transmissions
  add column if not exists canceled_at timestamptz;

alter table events
  add column if not exists legacy_convex_id text unique;

alter table points_ledger
  add column if not exists legacy_convex_id text unique;

alter table publication_metric_snapshots
  add column if not exists legacy_convex_id text unique;

alter table account_metric_snapshots
  add column if not exists legacy_convex_id text unique;

alter table daily_metric_snapshots
  add column if not exists legacy_convex_id text unique;

create table if not exists pending_facebook_connections (
  state_hash text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  payload_ciphertext bytea not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists provider_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references projections(id) on delete cascade,
  provider text not null,
  session_reference_ciphertext bytea not null,
  uploaded_bytes bigint not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (projection_id, provider)
);

create table if not exists api_idempotency_keys (
  api_key_id uuid references api_keys(id) on delete cascade,
  actor_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  status_code integer,
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  locked_until timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  primary key (actor_key, idempotency_key)
);

create table if not exists api_audit_logs (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  api_key_id uuid references api_keys(id) on delete set null,
  user_id uuid references app_users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  request_id text,
  source_ip inet,
  user_agent text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text not null,
  secret_ciphertext bytea not null,
  enabled boolean not null default true,
  event_types text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  outbox_event_id bigint references outbox_events(id) on delete set null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  response_status integer,
  response_summary text,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists meta_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_user_id text,
  confirmation_code text not null unique,
  signed_request_hash text not null unique,
  status text not null default 'received',
  deleted_connections integer not null default 0,
  requested_at timestamptz not null,
  completed_at timestamptz,
  legacy_convex_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists migration_id_map (
  source text not null,
  entity_type text not null,
  legacy_id text not null,
  postgres_id text not null,
  migrated_at timestamptz not null default now(),
  primary key (source, entity_type, legacy_id),
  unique (source, entity_type, postgres_id)
);

create table if not exists user_stats (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  lifetime_rp integer not null default 0,
  week_rp integer not null default 0,
  week_start_at timestamptz,
  streak_days integer not null default 0,
  last_post_day date,
  badges text[] not null default '{}',
  legacy_convex_id text unique,
  updated_at timestamptz not null default now()
);

create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  platforms text[] not null default '{}',
  base_caption text not null default '',
  caption_templates jsonb not null default '{}',
  hashtags text[] not null default '{}',
  default_time_of_day text,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projections_one_provider_per_transmission_idx
  on projections(transmission_id, provider);

create unique index if not exists social_accounts_one_provider_per_workspace_idx
  on social_accounts(workspace_id, provider);

create index if not exists workspace_memberships_user_idx
  on workspace_memberships(user_id);

create index if not exists social_accounts_workspace_status_idx
  on social_accounts(workspace_id, status);

create index if not exists api_idempotency_expiry_idx
  on api_idempotency_keys(expires_at);

create index if not exists api_audit_workspace_time_idx
  on api_audit_logs(workspace_id, occurred_at desc);

create index if not exists provider_upload_projection_idx
  on provider_upload_sessions(projection_id);

create index if not exists webhook_deliveries_due_idx
  on webhook_deliveries(next_attempt_at)
  where delivered_at is null;
