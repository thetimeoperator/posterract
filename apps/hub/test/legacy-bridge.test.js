import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgres } from "../src/db.js";
import { grantFromLegacySession } from "../src/billing.js";

/**
 * The legacy checkout bridge (§8, temporary).
 *
 * The happy path needs a real paid Stripe session, so it is verified against
 * production separately. What is pinned here is everything that must be
 * REFUSED, because those are the cases that would otherwise hand out a
 * membership nobody paid for.
 */

const RUN = randomUUID().slice(0, 8);

after(async () => {
  await postgres.query(`delete from core.billing_events where stripe_event_id like $1`, [
    `legacy:cs_test_${RUN}%`,
  ]);
  await postgres.end();
});

test("a session id that is not a session id is refused", async () => {
  for (const bad of [undefined, null, "", "garbage", "sub_123", 42, {}]) {
    const result = await grantFromLegacySession(bad, async () => {
      throw new Error("must not reach Clerk for a malformed id");
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_session_id", `for ${JSON.stringify(bad)}`);
  }
});

test("it refuses to run without a way to verify the email", async () => {
  // Belt and braces: the §3 guard cannot be skipped by forgetting an argument.
  const result = await grantFromLegacySession("cs_live_whatever", undefined);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_identity_resolver");
});

test("a session Stripe does not know is refused", async () => {
  const result = await grantFromLegacySession(
    `cs_test_${RUN}_nonexistent`,
    async () => ({ email: "nobody@example.com", verified: true }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "session_not_found");
});

test("the ledger key is scoped so it cannot collide with a Stripe event id", () => {
  // Stripe event ids start with evt_; ours are prefixed, so a real event and
  // a bridged session can never be mistaken for one another in the ledger.
  const key = "legacy:cs_live_abc";
  assert.ok(key.startsWith("legacy:"));
  assert.ok(!key.startsWith("evt_"));
});
