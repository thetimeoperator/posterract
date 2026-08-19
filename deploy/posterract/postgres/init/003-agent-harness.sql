create table if not exists agent_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'openrouter')),
  label text not null,
  model text not null,
  secret_hint text not null,
  secret_ciphertext bytea not null,
  status text not null default 'connected' check (status in ('connected', 'invalid', 'revoked')),
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  credential_id uuid references agent_credentials(id) on delete set null,
  api_key_id uuid references api_keys(id) on delete set null,
  user_id uuid references app_users(id) on delete set null,
  provider text not null,
  model text not null,
  skill_ids text[] not null default '{}',
  skill_versions jsonb not null default '{}',
  input jsonb not null,
  output jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'blocked')),
  source text not null check (source in ('ui', 'api')),
  error_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists agent_credentials_workspace_idx
  on agent_credentials(workspace_id, created_at desc);

create index if not exists agent_runs_workspace_time_idx
  on agent_runs(workspace_id, created_at desc);

create index if not exists api_keys_workspace_active_idx
  on api_keys(workspace_id, created_at desc)
  where revoked_at is null;
