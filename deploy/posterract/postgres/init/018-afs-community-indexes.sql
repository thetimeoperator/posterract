-- ============================================================================
-- Phase H — indexes and guards the community backend needs.
--
-- 017 created the afs tables. This adds what makes them safe and fast to read
-- under the access patterns the Wall and Rankings actually use.
-- ============================================================================

-- The points ledger is append-only, which means nothing stops the same award
-- being written twice — a retried GitHub sync would pay a member for the same
-- day over and over. Every idempotent award carries a ref_id (the ISO date for
-- a ship, the post id for a post, the streak milestone for a streak), so this
-- makes "one award per (person, kind, ref)" a database rule rather than
-- something the application has to remember.
--
-- ref_id is null only for one-off manual awards, which are allowed to repeat.
create unique index if not exists point_events_one_per_ref
  on afs.point_events (account_id, kind, ref_id)
  where ref_id is not null;

-- Monthly totals are read on every rankings load.
create index if not exists point_events_account_month
  on afs.point_events (account_id, created_at desc);

-- Streaks walk backwards day by day from today, per person.
create index if not exists ship_days_account_date
  on afs.ship_days (account_id, date desc);

-- The Wall lists newest-first and never shows hidden posts, so the partial
-- index matches the query exactly.
create index if not exists wall_posts_visible_new
  on afs.wall_posts (created_at desc)
  where hidden_at is null;

create index if not exists wall_posts_visible_fire
  on afs.wall_posts (fire_count desc, created_at desc)
  where hidden_at is null;

create index if not exists wall_posts_author
  on afs.wall_posts (account_id, created_at desc);

-- Reactions are counted per post and checked per viewer ("did I already fire
-- this?"). The primary key covers (post_id, account_id); this covers the
-- reverse lookup for a member's own reaction history.
create index if not exists wall_reactions_account
  on afs.wall_reactions (account_id, created_at desc);

-- The leaderboard orders by this month's points.
create index if not exists member_stats_points_month
  on afs.member_stats (points_month desc, points_all desc);

-- A handle is claimed case-insensitively: "Devon" and "devon" are the same
-- person's name and must not both exist. 017's plain unique index on handle
-- would have allowed both.
create unique index if not exists profiles_handle_lower
  on afs.profiles (lower(handle))
  where handle is not null;

-- Only one challenge may be running at a time, so the Wall can show "the"
-- current challenge without having to choose between overlapping rows.
create index if not exists challenges_window
  on afs.challenges (starts_at desc, ends_at desc);

-- A post may only be the winner of one challenge.
create unique index if not exists challenges_one_winner_per_post
  on afs.challenges (winner_post_id)
  where winner_post_id is not null;
