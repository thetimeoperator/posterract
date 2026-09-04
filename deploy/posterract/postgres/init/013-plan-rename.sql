-- The plan catalogue changed shape when generation moved onto our own keys:
-- 'creator' became 'editor' and stopped granting credits (it is the plan for
-- people bringing their own provider keys), and 'agency' became 'pro'. The
-- allotments were repriced at the same time — a credit is now one cent of
-- provider spend at our cost, so a plan's allotment reads directly as the most
-- a subscriber can cost us.
--
-- The old CHECK constraint pins the old names, so it has to be replaced before
-- any row can carry a new one.

alter table workspace_credits
  drop constraint if exists workspace_credits_plan_check;

update workspace_credits set plan = 'editor' where plan = 'creator';
update workspace_credits set plan = 'pro' where plan = 'agency';

alter table workspace_credits
  add constraint workspace_credits_plan_check
  check (plan in ('editor', 'studio', 'pro'));
