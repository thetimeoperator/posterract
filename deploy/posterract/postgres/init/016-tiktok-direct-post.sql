-- Additive: legacy TikTok inbox jobs and existing workflow histories are untouched.
create table if not exists tiktok_publish_sessions (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid unique references projections(id) on delete set null,
  state text not null default 'preparing' check (state in
    ('preparing', 'prepared', 'initializing', 'processing', 'complete', 'failed', 'ambiguous')),
  publish_id text,
  creator_username text,
  prepared_key text not null unique,
  size_bytes bigint,
  duration_ms integer,
  media_expires_at timestamptz not null default now() + interval '2 hours',
  media_cleaned_at timestamptz,
  last_platform_status text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tiktok_media_expiry_idx on tiktok_publish_sessions(media_expires_at)
  where media_cleaned_at is null;
