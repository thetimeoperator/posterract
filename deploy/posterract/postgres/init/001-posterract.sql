create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  name text not null,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (
    provider in ('instagram', 'tiktok', 'facebook', 'threads', 'x', 'youtube')
  ),
  provider_account_id text,
  handle text not null,
  display_name text,
  status text not null default 'connected',
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create table if not exists social_account_tokens (
  social_account_id uuid primary key references social_accounts(id) on delete cascade,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea,
  encryption_key_version integer not null default 1,
  refresh_expires_at timestamptz,
  provider_user_id text,
  updated_at timestamptz not null default now()
);

create table if not exists oauth_states (
  state_hash text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  payload_ciphertext bytea,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  original_filename text not null,
  r2_key text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_ms integer,
  width integer,
  height integer,
  status text not null check (
    status in (
      'uploading', 'ready', 'attached', 'scheduled', 'publishing',
      'purge_pending', 'purged', 'failed', 'aborted'
    )
  ),
  upload_completed_at timestamptz,
  purge_after timestamptz,
  purged_at timestamptz,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transmissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  media_asset_id uuid references media_assets(id) on delete restrict,
  title text not null,
  base_caption text not null default '',
  hashtags text[] not null default '{}',
  status text not null check (
    status in (
      'draft', 'scheduled', 'transmitting', 'live', 'partial',
      'failed', 'canceled'
    )
  ),
  schedule_mode text not null check (schedule_mode in ('now', 'at', 'next_slot')),
  scheduled_for timestamptz,
  source text not null check (source in ('ui', 'api', 'drive')),
  temporal_workflow_id text unique,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projections (
  id uuid primary key default gen_random_uuid(),
  transmission_id uuid not null references transmissions(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid references social_accounts(id) on delete restrict,
  provider text not null,
  caption text not null default '',
  hashtags text[] not null default '{}',
  platform_options jsonb not null default '{}',
  status text not null check (
    status in (
      'pending', 'scheduled', 'uploading', 'publishing', 'processing',
      'live', 'failed', 'retrying', 'needs_reauth', 'blocked'
    )
  ),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  platform_post_id text,
  platform_post_url text,
  error_category text,
  error_summary text,
  pending_container_id text,
  legacy_convex_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publish_attempts (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references projections(id) on delete cascade,
  attempt_number integer not null,
  status text not null,
  provider_code text,
  sanitized_summary jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (projection_id, attempt_number)
);

create table if not exists events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  transmission_id uuid references transmissions(id) on delete cascade,
  projection_id uuid references projections(id) on delete cascade,
  type text not null,
  message text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create table if not exists publication_metric_snapshots (
  id bigserial primary key,
  projection_id uuid not null references projections(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  views bigint not null default 0,
  engaged_views bigint,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint,
  estimated_minutes_watched numeric,
  average_view_duration_seconds numeric,
  average_view_percentage numeric,
  watch_time_seconds numeric,
  full_video_watched_rate numeric,
  raw_metrics jsonb not null default '{}',
  fetched_at timestamptz not null
);

create table if not exists account_metric_snapshots (
  id bigserial primary key,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  audience bigint,
  total_views bigint,
  total_likes bigint,
  published_videos bigint,
  raw_metrics jsonb not null default '{}',
  fetched_at timestamptz not null
);

create table if not exists daily_metric_snapshots (
  id bigserial primary key,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  metric_date date not null,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  watch_minutes numeric,
  audience_gained bigint not null default 0,
  audience_lost bigint not null default 0,
  raw_metrics jsonb not null default '{}',
  fetched_at timestamptz not null,
  unique (social_account_id, metric_date)
);

create table if not exists analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  social_account_id uuid references social_accounts(id) on delete cascade,
  provider text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_written integer not null default 0,
  error_summary text
);

create table if not exists points_ledger (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,
  amount integer not null,
  reference_id text,
  note text,
  awarded_at timestamptz not null default now(),
  unique (reference_id, source)
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  secret_hash text not null unique,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists outbox_events (
  id bigserial primary key,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists workspaces_owner_idx on workspaces(owner_id);
create index if not exists social_accounts_workspace_idx on social_accounts(workspace_id);
create index if not exists media_assets_workspace_status_idx on media_assets(workspace_id, status);
create index if not exists media_assets_purge_idx on media_assets(purge_after) where purged_at is null;
create index if not exists transmissions_workspace_status_idx on transmissions(workspace_id, status);
create index if not exists transmissions_schedule_idx on transmissions(scheduled_for) where status = 'scheduled';
create index if not exists projections_transmission_idx on projections(transmission_id);
create index if not exists projections_workspace_provider_idx on projections(workspace_id, provider);
create index if not exists events_workspace_time_idx on events(workspace_id, occurred_at desc);
create index if not exists publication_metrics_projection_time_idx
  on publication_metric_snapshots(projection_id, fetched_at desc);
create index if not exists account_metrics_account_time_idx
  on account_metric_snapshots(social_account_id, fetched_at desc);
create index if not exists daily_metrics_workspace_provider_date_idx
  on daily_metric_snapshots(workspace_id, provider, metric_date desc);
create index if not exists outbox_unprocessed_idx
  on outbox_events(created_at) where processed_at is null;
