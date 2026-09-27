-- Sign-in for connectors such as Meta Muse: OAuth 2.1 with PKCE and dynamic
-- client registration (apps/api/src/mcp/auth.js). A client registers
-- itself, the user approves it on /connect, and the resulting connection
-- (grant) belongs to one workspace. Codes and tokens are stored hashed;
-- access tokens last an hour, refresh tokens rotate and last 60 days.

create table if not exists oauth_clients (
  id text primary key,
  name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create index if not exists oauth_clients_created_idx on oauth_clients (created_at);

create table if not exists oauth_requests (
  id text primary key,
  client_id text not null references oauth_clients(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null,
  state text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references oauth_clients(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists oauth_grants_workspace_idx on oauth_grants (workspace_id) where revoked_at is null;

create table if not exists oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references oauth_grants(id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists oauth_tokens_grant_idx on oauth_tokens (grant_id);
