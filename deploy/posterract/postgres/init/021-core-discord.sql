-- ============================================================================
-- Discord — pay or leave (Push 6). Adds what the Hub needs on top of the three
-- tables 017 created:
--
--   core.discord_oauth_states  the single-use `state` for Join Discord: random,
--                              bound to one person, 10 minutes, burned on use
--   core.discord_first_seen    when someone was first seen in the server
--                              without a link (the 3-day clock before removal)
--   core.discord_links.guild_id  which server a link belongs to, so a sweep of
--                              one server never rewrites links of another
--
-- and makes the grandfather snapshot (decision 19) insert-only for the Hub:
-- the Hub may add rows, never change or remove one. Only the owner role can.
-- ============================================================================

create table if not exists core.discord_oauth_states (
  state       text primary key,
  account_id  uuid not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists discord_oauth_states_expires_idx
  on core.discord_oauth_states (expires_at);

create table if not exists core.discord_first_seen (
  discord_user_id text primary key,
  first_seen_at   timestamptz not null default now()
);

alter table core.discord_links
  add column if not exists guild_id text;

grant select, insert, update, delete
  on core.discord_oauth_states, core.discord_first_seen
  to hub;

revoke update, delete, truncate on core.discord_grandfathered from hub;
