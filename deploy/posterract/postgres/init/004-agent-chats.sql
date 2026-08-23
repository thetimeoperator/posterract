create table if not exists agent_chats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by_user_id uuid references app_users(id) on delete set null,
  title text not null default 'New chat',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references agent_chats(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_id uuid references agent_runs(id) on delete set null,
  role text not null check (role in ('user', 'agent')),
  body text not null check (length(body) between 1 and 20000),
  skill_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table agent_runs
  add column if not exists chat_id uuid references agent_chats(id) on delete set null;

create index if not exists agent_chats_workspace_updated_idx
  on agent_chats(workspace_id, updated_at desc)
  where archived_at is null;

create index if not exists agent_chat_messages_chat_time_idx
  on agent_chat_messages(chat_id, created_at asc);

create index if not exists agent_chat_messages_workspace_idx
  on agent_chat_messages(workspace_id, created_at desc);

create index if not exists agent_runs_chat_idx
  on agent_runs(chat_id, created_at asc)
  where chat_id is not null;
