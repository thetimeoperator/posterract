import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgres } from "../src/db.js";
import { resolveAccount, buildMe, accountIdForClerkUser } from "../src/accounts.js";

/**
 * Phase C acceptance tests (§11):
 *   new person · existing Posterract person with the same verified email links ·
 *   unverified email is refused · collision goes to the review queue, never
 *   merges · email change handled
 *
 * Runs against a scratch copy of production. Every row it creates is tagged
 * with a unique run id and removed afterwards.
 */

const RUN = randomUUID().slice(0, 8);
const mail = (name) => `hubtest-${RUN}-${name}@example.com`;
const clerkId = (name) => `user_hubtest_${RUN}_${name}`;

async function cleanup() {
  await postgres.query(
    `delete from core.review_queue
      where details->>'email' like $1
         or details->>'toEmail' like $1
         or account_id in (select id from app_users where email like $1)`,
    [`hubtest-${RUN}-%`],
  );
  await postgres.query(
    `delete from core.identities where provider_user_id like $1`,
    [`user_hubtest_${RUN}_%`],
  );
  await postgres.query(
    `delete from social_accounts where workspace_id in (
       select w.id from workspaces w
       join app_users u on u.id = w.owner_id
       where u.email like $1)`,
    [`hubtest-${RUN}-%`],
  );
  await postgres.query(
    `delete from workspace_memberships where user_id in (
       select id from app_users where email like $1)`,
    [`hubtest-${RUN}-%`],
  );
  await postgres.query(
    `delete from workspaces where owner_id in (
       select id from app_users where email like $1)`,
    [`hubtest-${RUN}-%`],
  );
  await postgres.query(`delete from app_users where email like $1`, [
    `hubtest-${RUN}-%`,
  ]);
}

after(async () => {
  await cleanup();
  await postgres.end();
});

test("a brand new person is created and fully provisioned", async () => {
  const email = mail("new");
  const result = await resolveAccount({
    clerkUserId: clerkId("new"),
    email,
    verified: true,
    displayName: "New Person",
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "created");

  const person = await postgres.query(
    `select id, email, email_verified, auth_user_id from app_users where lower(email) = $1`,
    [email],
  );
  assert.equal(person.rowCount, 1, "exactly one person");

  // Posterract's own flags must NOT be set by the Hub
  assert.equal(person.rows[0].email_verified, false, "email_verified left to Posterract");
  assert.equal(person.rows[0].auth_user_id, null, "auth_user_id left to better-auth");

  // provisioned the same shape Posterract's signup hook produces
  const workspace = await postgres.query(
    `select id from workspaces where owner_id = $1`,
    [person.rows[0].id],
  );
  assert.equal(workspace.rowCount, 1, "one workspace");

  const membership = await postgres.query(
    `select role from workspace_memberships where user_id = $1`,
    [person.rows[0].id],
  );
  assert.equal(membership.rows[0]?.role, "owner");

  const socials = await postgres.query(
    `select count(*)::int as n from social_accounts where workspace_id = $1`,
    [workspace.rows[0].id],
  );
  assert.equal(socials.rows[0].n, 6, "six social placeholders");
});

test("an existing Posterract person with the same verified email links, not duplicates", async () => {
  const email = mail("existing");

  // simulate someone who already signed up on Posterract
  const existing = await postgres.query(
    `insert into app_users (id, email, display_name, email_verified, auth_user_id)
     values (gen_random_uuid(), $1, 'Already Here', true, $2)
     returning id`,
    [email, `better_auth_${RUN}`],
  );
  const existingId = existing.rows[0].id;

  const result = await resolveAccount({
    clerkUserId: clerkId("existing"),
    email,
    verified: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "linked_existing");
  assert.equal(result.accountId, existingId, "same person, not a new one");

  const count = await postgres.query(
    `select count(*)::int as n from app_users where lower(email) = $1`,
    [email],
  );
  assert.equal(count.rows[0].n, 1, "still exactly one person");

  // their Posterract login is untouched
  const untouched = await postgres.query(
    `select auth_user_id, email_verified from app_users where id = $1`,
    [existingId],
  );
  assert.equal(untouched.rows[0].auth_user_id, `better_auth_${RUN}`);
  assert.equal(untouched.rows[0].email_verified, true);
});

test("an unverified email is refused and creates nothing", async () => {
  const email = mail("unverified");

  const result = await resolveAccount({
    clerkUserId: clerkId("unverified"),
    email,
    verified: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "email_not_verified");

  const person = await postgres.query(
    `select 1 from app_users where lower(email) = $1`,
    [email],
  );
  assert.equal(person.rowCount, 0, "no person created");

  const identity = await postgres.query(
    `select 1 from core.identities where provider_user_id = $1`,
    [clerkId("unverified")],
  );
  assert.equal(identity.rowCount, 0, "no identity created");
});

test("a second Clerk login for the same person goes to review, never merges", async () => {
  const email = mail("collision");

  await resolveAccount({
    clerkUserId: clerkId("collision_a"),
    email,
    verified: true,
  });

  const second = await resolveAccount({
    clerkUserId: clerkId("collision_b"),
    email,
    verified: true,
  });

  assert.equal(second.ok, false);
  assert.equal(second.reason, "collision");

  const identities = await postgres.query(
    `select count(*)::int as n from core.identities
      where account_id = (select id from app_users where lower(email) = $1)`,
    [email],
  );
  assert.equal(identities.rows[0].n, 1, "still only the first login attached");

  const review = await postgres.query(
    `select kind from core.review_queue
      where kind = 'identity_account_already_linked'
        and details->>'incomingClerkUserId' = $1`,
    [clerkId("collision_b")],
  );
  assert.equal(review.rowCount, 1, "parked for a human");
});

test("an email change is applied when the new address is free", async () => {
  const before = mail("change_before");
  const after_ = mail("change_after");

  const first = await resolveAccount({
    clerkUserId: clerkId("change"),
    email: before,
    verified: true,
  });
  assert.equal(first.ok, true);

  const changed = await resolveAccount({
    clerkUserId: clerkId("change"),
    email: after_,
    verified: true,
  });

  assert.equal(changed.ok, true);
  assert.equal(changed.action, "email_updated");
  assert.equal(changed.accountId, first.accountId, "same person");

  const identity = await postgres.query(
    `select email from core.identities where provider_user_id = $1`,
    [clerkId("change")],
  );
  assert.equal(identity.rows[0].email, after_);
});

test("an email change onto someone else's address goes to review, never merges", async () => {
  const mine = mail("clash_mine");
  const theirs = mail("clash_theirs");

  const me = await resolveAccount({
    clerkUserId: clerkId("clash_me"),
    email: mine,
    verified: true,
  });
  await resolveAccount({
    clerkUserId: clerkId("clash_them"),
    email: theirs,
    verified: true,
  });

  const attempt = await resolveAccount({
    clerkUserId: clerkId("clash_me"),
    email: theirs,
    verified: true,
  });

  assert.equal(attempt.ok, false);
  assert.equal(attempt.reason, "collision");

  // my identity still points at my original address
  const identity = await postgres.query(
    `select email, account_id from core.identities where provider_user_id = $1`,
    [clerkId("clash_me")],
  );
  assert.equal(identity.rows[0].email, mine, "unchanged");
  assert.equal(identity.rows[0].account_id, me.accountId);

  const review = await postgres.query(
    `select 1 from core.review_queue
      where kind = 'identity_email_collision' and details->>'toEmail' = $1`,
    [theirs],
  );
  assert.equal(review.rowCount, 1, "parked for a human");
});

test("resolve is idempotent", async () => {
  const email = mail("idem");
  const a = await resolveAccount({ clerkUserId: clerkId("idem"), email, verified: true });
  const b = await resolveAccount({ clerkUserId: clerkId("idem"), email, verified: true });
  const c = await resolveAccount({ clerkUserId: clerkId("idem"), email, verified: true });

  assert.equal(a.accountId, b.accountId);
  assert.equal(b.accountId, c.accountId);
  assert.equal(b.action, "existing");

  const people = await postgres.query(
    `select count(*)::int as n from app_users where lower(email) = $1`,
    [email],
  );
  assert.equal(people.rows[0].n, 1);
});

test("buildMe reports no entitlements until a membership exists", async () => {
  const email = mail("me");
  const { accountId } = await resolveAccount({
    clerkUserId: clerkId("me"),
    email,
    verified: true,
  });

  const me = await buildMe(accountId);
  assert.equal(me.account.email, email);
  assert.equal(me.entitlements.aiforsavages, false);
  assert.equal(me.entitlements.posterract, false);
  assert.equal(me.memberStreakMonths, 0);
  assert.equal(await accountIdForClerkUser(clerkId("me")), accountId);
});

test("an active AI FOR SAVAGES membership unlocks Posterract's base plan", async () => {
  const email = mail("member");
  const { accountId } = await resolveAccount({
    clerkUserId: clerkId("member"),
    email,
    verified: true,
  });

  await postgres.query(
    `insert into core.memberships
       (account_id, product_id, plan, status, source, current_period_end, member_since)
     values ($1, 'aiforsavages', 'monthly', 'active', 'stripe_subscription',
             now() + interval '20 days', now() - interval '4 months')`,
    [accountId],
  );

  const me = await buildMe(accountId);
  assert.equal(me.entitlements.aiforsavages, true);
  assert.equal(me.entitlements.posterract, true, "base plan included");
  assert.equal(me.memberStreakMonths, 4, "months elapsed, not invoice count");

  await postgres.query(`delete from core.memberships where account_id = $1`, [accountId]);
});
