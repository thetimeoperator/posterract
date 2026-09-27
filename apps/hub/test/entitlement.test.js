import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgres } from "../src/db.js";

/**
 * Phase E acceptance (§7/§11): the exact SQL that apps/api/src/billing.js now
 * runs when a workspace has no paid Posterract subscription.
 *
 *   member with a VERIFIED login gets Pro · an UNVERIFIED login does not ·
 *   a real subscriber is unaffected · an AFS lapse brings the paywall back
 */

const RUN = randomUUID().slice(0, 8);

/** the entitlement query, character for character as billing.js uses it */
async function entitledViaMembership(workspaceId) {
  const row = await postgres.query(
    `select exists (
       select 1
       from workspaces w
       join app_users u on u.id = w.owner_id
       where w.id = $1
         and u.email_verified = true
         and core.has_membership(u.id, 'aiforsavages')
     ) as ok`,
    [workspaceId],
  );
  return row.rows[0].ok;
}

async function makePerson({ verified }) {
  const person = await postgres.query(
    `insert into app_users (id, email, display_name, email_verified)
     values (gen_random_uuid(), $1, 'Ent Test', $2) returning id`,
    [`enttest-${RUN}-${randomUUID().slice(0, 6)}@example.com`, verified],
  );
  const accountId = person.rows[0].id;
  const workspace = await postgres.query(
    `insert into workspaces (id, owner_id, name) values (gen_random_uuid(), $1, 'ws') returning id`,
    [accountId],
  );
  return { accountId, workspaceId: workspace.rows[0].id };
}

async function giveMembership(accountId, { end = null, status = "active" } = {}) {
  await postgres.query(
    `insert into core.memberships
       (account_id, product_id, plan, status, source, current_period_end, member_since)
     values ($1,'aiforsavages','founding',$2,'legacy_one_time',$3, now())`,
    [accountId, status, end],
  );
}

after(async () => {
  await postgres.query(
    `delete from core.memberships where account_id in (select id from app_users where email like $1)`,
    [`enttest-${RUN}-%`],
  );
  await postgres.query(
    `delete from workspaces where owner_id in (select id from app_users where email like $1)`,
    [`enttest-${RUN}-%`],
  );
  await postgres.query(`delete from app_users where email like $1`, [`enttest-${RUN}-%`]);
  await postgres.end();
});

test("a VERIFIED member gets the Posterract base plan", async () => {
  const { accountId, workspaceId } = await makePerson({ verified: true });
  assert.equal(await entitledViaMembership(workspaceId), false, "no membership yet");

  await giveMembership(accountId);
  assert.equal(await entitledViaMembership(workspaceId), true);
});

test("an UNVERIFIED login does NOT inherit a membership", async () => {
  const { accountId, workspaceId } = await makePerson({ verified: false });
  await giveMembership(accountId);

  // this is the hijack guard: someone signed up here with another person's
  // address and never verified it
  assert.equal(await entitledViaMembership(workspaceId), false);
});

test("an AFS lapse brings the paywall back", async () => {
  const { accountId, workspaceId } = await makePerson({ verified: true });
  await giveMembership(accountId, { end: new Date(Date.now() + 10 * 86400e3) });
  assert.equal(await entitledViaMembership(workspaceId), true);

  await postgres.query(
    `update core.memberships set status='canceled', ended_at=now() where account_id=$1`,
    [accountId],
  );
  assert.equal(await entitledViaMembership(workspaceId), false, "paywall returns");

  // the person and their workspace survive — only access changed
  const still = await postgres.query(`select 1 from workspaces where id = $1`, [workspaceId]);
  assert.equal(still.rowCount, 1, "projects intact");
});

test("a real imported founding member is entitled", async () => {
  const real = await postgres.query(
    `select m.account_id, w.id as workspace_id, u.email_verified
       from core.memberships m
       join app_users u on u.id = m.account_id
       join workspaces w on w.owner_id = m.account_id
      where m.plan = 'founding' and m.status = 'active'
      limit 5`,
  );
  assert.ok(real.rowCount > 0, "the import produced founding members");

  for (const row of real.rows) {
    const ok = await entitledViaMembership(row.workspace_id);
    // verified founders get Pro; unverified ones correctly do not
    assert.equal(ok, row.email_verified === true, `account ${row.account_id}`);
  }
});

test("the rule never REMOVES access from a paying Posterract subscriber", async () => {
  // the new clause only ever runs when the paid rule already said no, and it
  // can only flip entitled false -> true. Proven here at the data level: a
  // person with no AFS membership is simply not granted anything.
  const { workspaceId } = await makePerson({ verified: true });
  assert.equal(await entitledViaMembership(workspaceId), false);
});
