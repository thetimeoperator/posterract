-- ============================================================================
-- 018 added three indexes that 017 had already created under different names,
-- byte-for-byte identical definitions. Duplicates are not harmless: every one
-- of them is a second tree to update on each insert, for no read benefit.
--
-- The 017 names are kept because they came first.
-- ============================================================================

-- == afs.point_events (account_id, created_at desc)
-- kept: point_events_account_idx
drop index if exists afs.point_events_account_month;

-- == afs.wall_posts (created_at desc) where hidden_at is null
-- kept: wall_posts_feed_idx
drop index if exists afs.wall_posts_visible_new;

-- == afs.wall_posts (account_id, created_at desc)
-- kept: wall_posts_account_idx
drop index if exists afs.wall_posts_author;
