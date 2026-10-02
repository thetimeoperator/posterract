-- Every post on a connected account, whichever app or tool made it: read
-- from Instagram, Threads, TikTok and Facebook by the worker each hour, so the
-- Analytics posting graph counts all of them, not just posts made through
-- Posterract (those show up here too, under the same platform post ID).

create table if not exists platform_posts (
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  platform_post_id text not null,
  published_at timestamptz not null,
  permalink text,
  kind text,
  first_seen_at timestamptz not null default now(),
  primary key (social_account_id, platform_post_id)
);

create index if not exists platform_posts_workspace_published_idx
  on platform_posts (workspace_id, published_at desc);

-- posts_covered_from: platform_posts holds every post on the account from
-- this time on. posts_synced_at: the last complete read of the account.
alter table social_accounts
  add column if not exists posts_synced_at timestamptz;

alter table social_accounts
  add column if not exists posts_covered_from timestamptz;
