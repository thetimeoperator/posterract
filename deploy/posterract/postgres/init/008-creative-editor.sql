-- Agent-native creative projects. Source text and immutable revisions live in
-- PostgreSQL; media and compiled/rendered binary objects remain in R2.

create table if not exists creative_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'rendering', 'ready', 'archived', 'deleting', 'deleted')),
  entry_path text not null default 'index.tsx',
  width integer not null default 1080 check (width > 0 and width <= 4096),
  height integer not null default 1920 check (height > 0 and height <= 4096),
  frame_rate numeric not null default 30 check (frame_rate > 0 and frame_rate <= 60),
  default_duration_ms integer not null default 10000 check (default_duration_ms > 0),
  retention_policy text not null default 'temporary' check (retention_policy in ('temporary', 'external_backed', 'persistent')),
  current_revision_id uuid,
  last_good_revision_id uuid,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_by_api_key_id uuid references api_keys(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_opened_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  purge_after timestamptz
);

create index if not exists creative_projects_workspace_updated_idx
  on creative_projects (workspace_id, updated_at desc);
create index if not exists creative_projects_workspace_status_idx
  on creative_projects (workspace_id, status);

create table if not exists creative_project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references creative_projects(id) on delete cascade,
  revision_number bigint not null,
  parent_revision_id uuid references creative_project_revisions(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'agent_api_key', 'mcp', 'template', 'system')),
  actor_user_id uuid references app_users(id) on delete set null,
  actor_api_key_id uuid references api_keys(id) on delete set null,
  message text,
  source_hash text not null,
  compile_status text not null default 'pending' check (compile_status in ('pending', 'compiling', 'succeeded', 'failed')),
  compile_diagnostics jsonb not null default '[]'::jsonb,
  runtime_version text not null default 'diffusion-aeb873b',
  document_summary jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, revision_number)
);

create index if not exists creative_revisions_project_created_idx
  on creative_project_revisions (project_id, created_at desc);

create table if not exists creative_project_revision_files (
  revision_id uuid not null references creative_project_revisions(id) on delete cascade,
  path text not null,
  content text not null,
  content_hash text not null,
  language text not null check (language in ('tsx', 'ts', 'json', 'md')),
  size_bytes integer not null check (size_bytes >= 0),
  primary key (revision_id, path)
);

create table if not exists creative_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references creative_projects(id) on delete cascade,
  base_revision_id uuid not null references creative_project_revisions(id) on delete cascade,
  committed_revision_id uuid references creative_project_revisions(id) on delete set null,
  batch_id uuid not null,
  idempotency_key text not null,
  actor_type text not null check (actor_type in ('user', 'agent_api_key', 'mcp', 'system')),
  actor_user_id uuid references app_users(id) on delete set null,
  actor_api_key_id uuid references api_keys(id) on delete set null,
  operations jsonb not null,
  status text not null check (status in ('accepted', 'committed', 'conflicted', 'rejected')),
  error_code text,
  error_detail jsonb,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (project_id, idempotency_key)
);

create table if not exists creative_project_assets (
  project_id uuid not null references creative_projects(id) on delete cascade,
  path text not null,
  media_asset_id uuid not null references media_assets(id) on delete restrict,
  size_bytes bigint not null check (size_bytes > 0),
  mime_type text not null,
  modified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (project_id, path),
  unique (project_id, media_asset_id)
);

create index if not exists creative_assets_project_modified_idx
  on creative_project_assets (project_id, modified_at desc);

create table if not exists creative_project_asset_manifests (
  project_id uuid primary key references creative_projects(id) on delete cascade,
  manifest jsonb not null default '{"version":1,"folders":[],"assets":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creative_projects_current_revision_fk'
  ) then
    alter table creative_projects
      add constraint creative_projects_current_revision_fk
      foreign key (current_revision_id) references creative_project_revisions(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'creative_projects_last_good_revision_fk'
  ) then
    alter table creative_projects
      add constraint creative_projects_last_good_revision_fk
      foreign key (last_good_revision_id) references creative_project_revisions(id) on delete set null;
  end if;
end
$$;
