-- AI generation credits. Workspaces hold one credit account whose balance is
-- reset to the plan allotment on every paid subscription cycle (no rollover at
-- launch). Every balance change is recorded in an immutable ledger, and every
-- paid generation is tracked end to end for idempotent replay and dedup.

create table if not exists workspace_credits (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  plan text check (plan in ('creator', 'studio', 'agency')),
  balance integer not null default 0 check (balance >= 0),
  allotment integer not null default 0 check (allotment >= 0),
  cycle_started_at timestamptz,
  cycle_resets_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  idempotency_key text not null,
  declaration_hash text,
  kind text not null check (kind in ('image', 'video', 'voice', 'transcribe')),
  model text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'reserved' check (
    status in ('reserved', 'running', 'succeeded', 'failed', 'refunded')
  ),
  credits_quoted integer not null check (credits_quoted >= 0),
  credits_settled integer not null default 0 check (credits_settled >= 0),
  output jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create index if not exists ai_generations_workspace_declaration_idx
  on ai_generations (workspace_id, declaration_hash);

create index if not exists ai_generations_workspace_created_idx
  on ai_generations (workspace_id, created_at desc);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  delta integer not null,
  kind text not null check (
    kind in ('grant', 'reserve', 'settle', 'refund', 'expire')
  ),
  generation_id uuid references ai_generations(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_workspace_created_idx
  on credit_ledger (workspace_id, created_at desc);
