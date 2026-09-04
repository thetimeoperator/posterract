-- The plan names became pro / allstar / superstar.
--
--   pro        $20  no generation (bring your own provider keys)
--   allstar    $49  1,200 credits, 768p video, 120 transcription minutes
--   superstar  $99  3,000 credits, adds 2k video, 400 minutes
--
-- The CHECK constraint pins the old names, so it has to be replaced before any
-- row can carry a new one. Existing rows map by tier, not by name: the old
-- 'pro' was the top tier and becomes 'superstar', so the rename runs in an
-- order that never collides with a name it is about to create.

alter table workspace_credits
  drop constraint if exists workspace_credits_plan_check;

update workspace_credits set plan = 'superstar' where plan = 'pro';
update workspace_credits set plan = 'allstar' where plan = 'studio';
update workspace_credits set plan = 'pro' where plan = 'editor';

alter table workspace_credits
  add constraint workspace_credits_plan_check
  check (plan in ('pro', 'allstar', 'superstar'));
