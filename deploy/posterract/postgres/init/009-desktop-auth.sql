-- Native Posterract Desktop authorization. Browser sessions, agent API keys,
-- and provider OAuth tokens remain separate credential classes.

create table if not exists desktop_authorization_grants (
  id uuid primary key default gen_random_uuid(),
  poll_token_hash text not null unique,
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
    check (code_challenge_method = 'S256'),
  device_name text not null,
  platform text not null,
  app_version text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'consumed', 'denied', 'expired')),
  approved_user_id uuid references app_users(id) on delete cascade,
  approved_workspace_id uuid references workspaces(id) on delete cascade,
  approved_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists desktop_authorization_grants_expiry_idx
  on desktop_authorization_grants (expires_at);

create table if not exists desktop_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  platform text not null,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists desktop_devices_user_created_idx
  on desktop_devices (user_id, created_at desc);
create index if not exists desktop_devices_workspace_idx
  on desktop_devices (workspace_id, revoked_at);

create table if not exists desktop_access_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references desktop_devices(id) on delete cascade,
  secret_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists desktop_access_tokens_device_idx
  on desktop_access_tokens (device_id, expires_at desc);

create table if not exists desktop_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references desktop_devices(id) on delete cascade,
  family_id uuid not null,
  secret_hash text not null unique,
  replaced_by_id uuid references desktop_refresh_tokens(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists desktop_refresh_tokens_device_idx
  on desktop_refresh_tokens (device_id, expires_at desc);
create index if not exists desktop_refresh_tokens_family_idx
  on desktop_refresh_tokens (family_id);
