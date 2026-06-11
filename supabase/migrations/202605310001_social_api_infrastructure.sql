create extension if not exists pgcrypto;

create schema if not exists private;

do $$
begin
  create type public.social_platform as enum (
    'tiktok',
    'instagram',
    'youtube-shorts',
    'x',
    'threads',
    'facebook',
    'linkedin'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.account_connection_status as enum (
    'connected',
    'needs_connection',
    'needs_reauth',
    'pending_approval',
    'unavailable'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.provider_approval_status as enum ('ready', 'pending_review', 'dev_only', 'blocked');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.capsule_status as enum ('draft', 'ready', 'scheduled', 'posting', 'posted', 'failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.publish_job_status as enum (
    'draft',
    'scheduled',
    'claiming',
    'uploading_media',
    'publishing',
    'processing',
    'posted',
    'failed',
    'retrying',
    'needs_reauth',
    'blocked_by_platform'
  );
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.add_workspace_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, profile_id, role)
  values (new.id, new.owner_profile_id, 'owner')
  on conflict (workspace_id, profile_id) do update
  set role = 'owner';
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  handle text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);

create table if not exists public.content_capsules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  client_ref text,
  mode_id text not null,
  status public.capsule_status not null default 'draft',
  title text not null,
  summary text,
  caption_base text not null default '',
  hashtags text[] not null default '{}',
  duration_ms integer,
  aspect_ratio text,
  thumbnail_asset_id uuid,
  primary_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  capsule_id uuid references public.content_capsules (id) on delete set null,
  storage_bucket text not null default 'vidtryx-assets',
  storage_path text not null,
  public_preview_url text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  duration_ms integer,
  aspect_ratio text,
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

do $$
begin
  alter table public.content_capsules
    add constraint content_capsules_workspace_client_ref_unique unique (workspace_id, client_ref);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.content_capsules
    add constraint content_capsules_thumbnail_asset_id_fkey
    foreign key (thumbnail_asset_id) references public.assets (id) on delete set null;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.content_capsules
    add constraint content_capsules_primary_asset_id_fkey
    foreign key (primary_asset_id) references public.assets (id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.platform_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.social_platform not null,
  provider_account_id text not null,
  handle text not null,
  display_name text,
  avatar_url text,
  scopes text[] not null default '{}',
  status public.account_connection_status not null default 'needs_connection',
  approval_status public.provider_approval_status not null default 'dev_only',
  token_expires_at timestamptz,
  last_health_check_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_account_id)
);

create table if not exists public.post_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  capsule_id uuid not null references public.content_capsules (id) on delete cascade,
  platform_account_id uuid not null references public.platform_accounts (id) on delete cascade,
  provider public.social_platform not null,
  title text not null,
  caption text not null default '',
  hashtags text[] not null default '{}',
  media_asset_id uuid references public.assets (id) on delete set null,
  media_storage_path text,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.distribution_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  capsule_id uuid not null references public.content_capsules (id) on delete cascade,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  status public.publish_job_status not null default 'scheduled',
  schedule_mode text not null check (schedule_mode in ('now', 'later')),
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  distribution_run_id uuid not null references public.distribution_runs (id) on delete cascade,
  capsule_id uuid not null references public.content_capsules (id) on delete cascade,
  package_id uuid not null references public.post_packages (id) on delete cascade,
  platform_account_id uuid not null references public.platform_accounts (id) on delete cascade,
  provider public.social_platform not null,
  status public.publish_job_status not null default 'scheduled',
  scheduled_for timestamptz not null,
  claimed_by text,
  claimed_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  idempotency_key text not null default encode(gen_random_bytes(18), 'hex'),
  platform_media_id text,
  platform_post_id text,
  platform_post_url text,
  error_category text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_id uuid not null references public.publish_jobs (id) on delete cascade,
  attempt_number integer not null,
  status public.publish_job_status not null,
  provider_request_id text,
  error_category text,
  response_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.publish_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  distribution_run_id uuid references public.distribution_runs (id) on delete cascade,
  job_id uuid references public.publish_jobs (id) on delete cascade,
  event_type text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_capabilities (
  provider public.social_platform primary key,
  label text not null,
  required_scopes text[] not null default '{}',
  approval_status public.provider_approval_status not null default 'dev_only',
  media_mode text not null check (media_mode in ('direct_upload', 'pull_from_url', 'mixed')),
  notes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists private.platform_tokens_private (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  platform_account_id uuid not null references public.platform_accounts (id) on delete cascade,
  provider public.social_platform not null,
  vault_access_token_secret_name text,
  vault_refresh_token_secret_name text,
  encrypted_access_token bytea,
  encrypted_refresh_token bytea,
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  refresh_available boolean not null default false,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_account_id)
);

create table if not exists private.oauth_states_private (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete cascade,
  provider public.social_platform not null,
  state_hash text not null unique,
  pkce_verifier_secret_name text,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  alter table public.assets
    add constraint assets_vidtryx_storage_path_workspace_prefix
    check (
      storage_bucket <> 'vidtryx-assets'
      or storage_path like workspace_id::text || '/%'
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.post_packages
    add constraint post_packages_media_storage_path_workspace_prefix
    check (
      media_storage_path is null
      or media_storage_path like workspace_id::text || '/%'
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.content_capsules
    add constraint content_capsules_id_workspace_unique unique (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.assets
    add constraint assets_id_workspace_unique unique (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.platform_accounts
    add constraint platform_accounts_id_workspace_provider_unique unique (id, workspace_id, provider);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.post_packages
    add constraint post_packages_id_workspace_provider_unique unique (id, workspace_id, provider);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.distribution_runs
    add constraint distribution_runs_id_workspace_unique unique (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_jobs
    add constraint publish_jobs_id_workspace_unique unique (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.assets
    add constraint assets_capsule_workspace_fkey
    foreign key (capsule_id, workspace_id) references public.content_capsules (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.content_capsules
    add constraint capsules_thumbnail_asset_workspace_fkey
    foreign key (thumbnail_asset_id, workspace_id) references public.assets (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.content_capsules
    add constraint capsules_primary_asset_workspace_fkey
    foreign key (primary_asset_id, workspace_id) references public.assets (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.post_packages
    add constraint post_packages_capsule_workspace_fkey
    foreign key (capsule_id, workspace_id) references public.content_capsules (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.post_packages
    add constraint post_packages_account_workspace_provider_fkey
    foreign key (platform_account_id, workspace_id, provider) references public.platform_accounts (id, workspace_id, provider) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.post_packages
    add constraint post_packages_media_asset_workspace_fkey
    foreign key (media_asset_id, workspace_id) references public.assets (id, workspace_id);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.distribution_runs
    add constraint distribution_runs_capsule_workspace_fkey
    foreign key (capsule_id, workspace_id) references public.content_capsules (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_jobs
    add constraint publish_jobs_run_workspace_fkey
    foreign key (distribution_run_id, workspace_id) references public.distribution_runs (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_jobs
    add constraint publish_jobs_capsule_workspace_fkey
    foreign key (capsule_id, workspace_id) references public.content_capsules (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_jobs
    add constraint publish_jobs_package_workspace_provider_fkey
    foreign key (package_id, workspace_id, provider) references public.post_packages (id, workspace_id, provider) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_jobs
    add constraint publish_jobs_account_workspace_provider_fkey
    foreign key (platform_account_id, workspace_id, provider) references public.platform_accounts (id, workspace_id, provider) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_attempts
    add constraint publish_attempts_job_workspace_fkey
    foreign key (job_id, workspace_id) references public.publish_jobs (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_events
    add constraint publish_events_run_workspace_fkey
    foreign key (distribution_run_id, workspace_id) references public.distribution_runs (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.publish_events
    add constraint publish_events_job_workspace_fkey
    foreign key (job_id, workspace_id) references public.publish_jobs (id, workspace_id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table private.platform_tokens_private
    add constraint platform_tokens_account_workspace_provider_fkey
    foreign key (platform_account_id, workspace_id, provider) references public.platform_accounts (id, workspace_id, provider) on delete cascade;
exception
  when duplicate_object then null;
end $$;

create index if not exists assets_workspace_idx on public.assets (workspace_id, created_at desc);
create index if not exists capsules_workspace_idx on public.content_capsules (workspace_id, created_at desc);
create index if not exists platform_accounts_workspace_idx on public.platform_accounts (workspace_id, provider);
create index if not exists post_packages_capsule_idx on public.post_packages (capsule_id, provider);
create index if not exists publish_jobs_due_idx on public.publish_jobs (status, scheduled_for, next_attempt_at);
create index if not exists publish_jobs_workspace_idx on public.publish_jobs (workspace_id, created_at desc);
create index if not exists publish_events_workspace_idx on public.publish_events (workspace_id, created_at desc);
create index if not exists platform_tokens_workspace_idx on private.platform_tokens_private (workspace_id, provider);
create index if not exists oauth_states_expires_idx on private.oauth_states_private (expires_at) where consumed_at is null;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces
for each row execute function public.set_updated_at();

drop trigger if exists workspaces_add_owner_member on public.workspaces;
create trigger workspaces_add_owner_member after insert on public.workspaces
for each row execute function public.add_workspace_owner_member();

drop trigger if exists capsules_set_updated_at on public.content_capsules;
create trigger capsules_set_updated_at before update on public.content_capsules
for each row execute function public.set_updated_at();

drop trigger if exists platform_accounts_set_updated_at on public.platform_accounts;
create trigger platform_accounts_set_updated_at before update on public.platform_accounts
for each row execute function public.set_updated_at();

drop trigger if exists post_packages_set_updated_at on public.post_packages;
create trigger post_packages_set_updated_at before update on public.post_packages
for each row execute function public.set_updated_at();

drop trigger if exists distribution_runs_set_updated_at on public.distribution_runs;
create trigger distribution_runs_set_updated_at before update on public.distribution_runs
for each row execute function public.set_updated_at();

drop trigger if exists publish_jobs_set_updated_at on public.publish_jobs;
create trigger publish_jobs_set_updated_at before update on public.publish_jobs
for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.profile_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.profile_id = auth.uid()
      and member.role = any(allowed_roles)
  );
$$;

create or replace function public.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text;
begin
  first_segment := split_part(object_name, '/', 1);
  begin
    return first_segment::uuid;
  exception
    when invalid_text_representation then
      return null;
  end;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.content_capsules enable row level security;
alter table public.assets enable row level security;
alter table public.platform_accounts enable row level security;
alter table public.post_packages enable row level security;
alter table public.distribution_runs enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.publish_attempts enable row level security;
alter table public.publish_events enable row level security;
alter table public.platform_capabilities enable row level security;
alter table private.platform_tokens_private enable row level security;
alter table private.oauth_states_private enable row level security;

revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
revoke all on function public.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated, service_role;
revoke all on function public.storage_workspace_id(text) from public, anon;
grant execute on function public.storage_workspace_id(text) to authenticated, service_role;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
with check (id = auth.uid());

drop policy if exists workspaces_select_member on public.workspaces;
create policy workspaces_select_member on public.workspaces for select to authenticated
using (public.is_workspace_member(id));

drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner on public.workspaces for insert to authenticated
with check (owner_profile_id = auth.uid());

drop policy if exists workspaces_update_admin on public.workspaces;
create policy workspaces_update_admin on public.workspaces for update to authenticated
using (public.has_workspace_role(id, array['owner', 'admin']))
with check (public.has_workspace_role(id, array['owner', 'admin']));

drop policy if exists workspace_members_select_member on public.workspace_members;
create policy workspace_members_select_member on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert_admin on public.workspace_members;
create policy workspace_members_insert_admin on public.workspace_members for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner', 'admin']));

drop policy if exists workspace_members_update_owner on public.workspace_members;
create policy workspace_members_update_owner on public.workspace_members for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner']))
with check (public.has_workspace_role(workspace_id, array['owner']));

drop policy if exists workspace_members_delete_owner on public.workspace_members;
create policy workspace_members_delete_owner on public.workspace_members for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner']));

drop policy if exists capsules_member_all on public.content_capsules;
create policy capsules_member_all on public.content_capsules for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists assets_member_all on public.assets;
create policy assets_member_all on public.assets for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists platform_accounts_member_select on public.platform_accounts;
create policy platform_accounts_member_select on public.platform_accounts for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists platform_accounts_admin_write on public.platform_accounts;

drop policy if exists post_packages_member_all on public.post_packages;
create policy post_packages_member_all on public.post_packages for all to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists distribution_runs_member_all on public.distribution_runs;

drop policy if exists distribution_runs_member_select on public.distribution_runs;
create policy distribution_runs_member_select on public.distribution_runs for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists distribution_runs_member_insert on public.distribution_runs;
create policy distribution_runs_member_insert on public.distribution_runs for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and status in ('draft', 'scheduled')
);

drop policy if exists publish_jobs_member_select on public.publish_jobs;
create policy publish_jobs_member_select on public.publish_jobs for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists publish_jobs_member_insert on public.publish_jobs;
create policy publish_jobs_member_insert on public.publish_jobs for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and status in ('draft', 'scheduled')
);

drop policy if exists publish_attempts_member_select on public.publish_attempts;
create policy publish_attempts_member_select on public.publish_attempts for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists publish_events_member_select on public.publish_events;
create policy publish_events_member_select on public.publish_events for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists platform_capabilities_read on public.platform_capabilities;
create policy platform_capabilities_read on public.platform_capabilities for select to authenticated
using (true);

insert into public.platform_capabilities (provider, label, required_scopes, approval_status, media_mode, notes)
values
  ('youtube-shorts', 'YouTube Shorts', array['https://www.googleapis.com/auth/youtube.upload'], 'dev_only', 'direct_upload', array['Uses YouTube Data API videos.insert.']),
  ('x', 'X', array['tweet.write', 'tweet.read', 'users.read', 'media.write', 'offline.access'], 'dev_only', 'direct_upload', array['Uploads media first, then creates the post.']),
  ('tiktok', 'TikTok', array['video.publish'], 'pending_review', 'mixed', array['Requires Content Posting API approval and explicit consent.']),
  ('instagram', 'Instagram', array['instagram_content_publish'], 'pending_review', 'pull_from_url', array['Requires Meta app review and current professional account setup.']),
  ('facebook', 'Facebook', array['pages_manage_posts', 'pages_read_engagement'], 'pending_review', 'mixed', array['Requires Meta app review and page permissions.']),
  ('linkedin', 'LinkedIn', array['w_member_social'], 'dev_only', 'direct_upload', array['Uses upload registration plus Posts API.']),
  ('threads', 'Threads', array[]::text[], 'pending_review', 'pull_from_url', array['Add after Meta auth is stable.'])
on conflict (provider) do update
set label = excluded.label,
    required_scopes = excluded.required_scopes,
    approval_status = excluded.approval_status,
    media_mode = excluded.media_mode,
    notes = excluded.notes,
    updated_at = now();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vidtryx-assets',
  'vidtryx-assets',
  false,
  1073741824,
  array['video/mp4', 'video/quicktime', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vidtryx_assets_select_member on storage.objects;
create policy vidtryx_assets_select_member on storage.objects for select to authenticated
using (
  bucket_id = 'vidtryx-assets'
  and position('/' in name) > 0
  and public.is_workspace_member(public.storage_workspace_id(name))
);

drop policy if exists vidtryx_assets_insert_member on storage.objects;
create policy vidtryx_assets_insert_member on storage.objects for insert to authenticated
with check (
  bucket_id = 'vidtryx-assets'
  and position('/' in name) > 0
  and public.is_workspace_member(public.storage_workspace_id(name))
);

drop policy if exists vidtryx_assets_update_member on storage.objects;
create policy vidtryx_assets_update_member on storage.objects for update to authenticated
using (
  bucket_id = 'vidtryx-assets'
  and position('/' in name) > 0
  and public.is_workspace_member(public.storage_workspace_id(name))
)
with check (
  bucket_id = 'vidtryx-assets'
  and position('/' in name) > 0
  and public.is_workspace_member(public.storage_workspace_id(name))
);

create or replace function public.claim_due_publish_jobs(max_jobs integer default 10, worker_id text default null)
returns setof public.publish_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due_jobs as (
    select id
    from public.publish_jobs
    where status in ('scheduled', 'retrying')
      and scheduled_for <= now()
      and (next_attempt_at is null or next_attempt_at <= now())
    order by scheduled_for asc, created_at asc
    limit greatest(1, least(coalesce(max_jobs, 10), 50))
    for update skip locked
  )
  update public.publish_jobs jobs
  set status = 'claiming',
      claimed_by = coalesce(worker_id, 'vidtryx-worker'),
      claimed_at = now(),
      updated_at = now()
  from due_jobs
  where jobs.id = due_jobs.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_due_publish_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_due_publish_jobs(integer, text) to service_role;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
grant usage on schema private to service_role;
grant all privileges on all tables in schema private to service_role;
grant all privileges on all sequences in schema private to service_role;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private grant all privileges on tables to service_role;
alter default privileges in schema private grant all privileges on sequences to service_role;
