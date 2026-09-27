#!/usr/bin/env node
/**
 * One-time import of today's AI FOR SAVAGES members (§10).
 *
 * These are the people who paid the old one-time price. They become FOUNDING
 * members: active forever, never billed again, and they get the Posterract
 * base plan for as long as they are members.
 *
 * DRY-RUN BY DEFAULT. Nothing is written without --apply.
 *
 *   node apps/hub/scripts/import-afs-members.mjs              # dry run
 *   node apps/hub/scripts/import-afs-members.mjs --only a@b.c # one person
 *   node apps/hub/scripts/import-afs-members.mjs --apply      # write
 *
 * Safe to re-run at any time: every write is an upsert keyed on the person.
 *
 * Rules it will not break:
 *   - only a VERIFIED Clerk primary email may link a person (§3)
 *   - email_verified is never set here — that is Posterract's own flag
 *   - nothing is ever merged; collisions are reported and skipped
 */

import { writeFileSync } from "node:fs";

import { postgres, withTransaction, normalizeEmail } from "../src/db.js";
import { findOrCreatePerson } from "../src/provisioning.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = (() => {
  const i = args.indexOf("--only");
  return i >= 0 ? normalizeEmail(args[i + 1]) : null;
})();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
  CLERK_SECRET_KEY,
})) {
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(1);
  }
}

const log = (...parts) => console.log(...parts);

/* ------------------------------------------------------------------ */
/* 1. read the premium members out of Supabase (read-only)             */
/* ------------------------------------------------------------------ */

async function loadPremiumProfiles() {
  const rows = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const url =
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?select=clerk_user_id,email,full_name,created_at,stripe_customer_id,subscription_status` +
      `&subscription_status=eq.premium&order=created_at.asc&limit=${page}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!response.ok) throw new Error(`supabase ${response.status}`);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* 2. Clerk is the source of truth for the email (profiles.email is    */
/*    written once and goes stale — §2)                                */
/* ------------------------------------------------------------------ */

async function loadClerkUsers(ids) {
  const found = new Map();
  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const query = slice.map((id) => `user_id=${encodeURIComponent(id)}`).join("&");
    const response = await fetch(
      `https://api.clerk.com/v1/users?limit=${batchSize}&${query}`,
      { headers: { Authorization: `Bearer ${CLERK_SECRET_KEY}` } },
    );
    if (!response.ok) throw new Error(`clerk ${response.status}`);
    for (const user of await response.json()) found.set(user.id, user);
    process.stderr.write(`\r  clerk: ${Math.min(i + batchSize, ids.length)}/${ids.length}`);
  }
  process.stderr.write("\r");
  return found;
}

function verifiedPrimary(user) {
  const primary = (user.email_addresses ?? []).find(
    (entry) => entry.id === user.primary_email_address_id,
  );
  if (!primary) return { email: null, verified: false, reason: "no_primary_email" };
  return {
    email: normalizeEmail(primary.email_address),
    verified: primary.verification?.status === "verified",
    reason: primary.verification?.status === "verified" ? null : "email_not_verified",
  };
}

/* ------------------------------------------------------------------ */
/* 3. import one person                                                */
/* ------------------------------------------------------------------ */

async function importOne(client, { profile, clerkUser, email }) {
  // the person (creates workspace + socials if new). Never sets
  // email_verified or auth_user_id — those belong to Posterract.
  const { accountId, created } = await findOrCreatePerson(client, {
    email,
    displayName: profile.full_name ?? null,
    imageUrl: clerkUser.image_url ?? null,
  });

  // is this person already holding a DIFFERENT Clerk login?
  const clash = await client.query(
    `select provider_user_id from core.identities
      where provider = 'clerk' and account_id = $1`,
    [accountId],
  );
  if (clash.rows[0] && clash.rows[0].provider_user_id !== profile.clerk_user_id) {
    return { outcome: "collision", accountId };
  }

  await client.query(
    `insert into core.identities (account_id, provider, provider_user_id, email, verified_at)
     values ($1, 'clerk', $2, $3, now())
     on conflict (provider, provider_user_id) do update
       set email = excluded.email, updated_at = now()`,
    [accountId, profile.clerk_user_id, email],
  );

  // founding membership: never expires, never billed again
  const memberSince =
    profile.created_at ?? clerkUser.created_at
      ? new Date(profile.created_at ?? clerkUser.created_at)
      : new Date();

  const existing = await client.query(
    `select id from core.memberships
      where account_id = $1 and product_id = 'aiforsavages'
        and status in ('active','past_due')`,
    [accountId],
  );

  if (existing.rows[0]) {
    await client.query(
      `update core.memberships
          set plan = 'founding', status = 'active', source = 'legacy_one_time',
              current_period_end = null,
              stripe_customer_id = coalesce($2, stripe_customer_id),
              updated_at = now()
        where id = $1`,
      [existing.rows[0].id, profile.stripe_customer_id ?? null],
    );
  } else {
    await client.query(
      `insert into core.memberships
         (account_id, product_id, plan, status, source,
          stripe_customer_id, current_period_end, member_since)
       values ($1,'aiforsavages','founding','active','legacy_one_time',$2,null,$3)`,
      [accountId, profile.stripe_customer_id ?? null, memberSince],
    );
  }

  // carry anything worth keeping into the new profile table
  await client.query(
    `insert into afs.profiles (account_id) values ($1)
     on conflict (account_id) do nothing`,
    [accountId],
  );

  return { outcome: created ? "created" : "linked", accountId };
}

/* ------------------------------------------------------------------ */

async function main() {
  log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (nothing will be written)");
  if (ONLY) log(`filter: only ${ONLY}`);
  log("");

  let profiles = await loadPremiumProfiles();
  log(`premium profiles in Supabase: ${profiles.length}`);

  if (ONLY) {
    profiles = profiles.filter((p) => normalizeEmail(p.email) === ONLY);
    log(`after --only filter: ${profiles.length}`);
  }

  const withClerk = profiles.filter((p) => p.clerk_user_id);
  const missingClerk = profiles.length - withClerk.length;

  const clerkUsers = await loadClerkUsers(withClerk.map((p) => p.clerk_user_id));

  const counts = {
    created: 0,
    linked: 0,
    collision: 0,
    skipped_unverified: 0,
    skipped_no_clerk_user: 0,
    skipped_no_clerk_id: missingClerk,
  };
  const report = [["email", "clerk_user_id", "outcome", "detail"]];

  for (const profile of withClerk) {
    const user = clerkUsers.get(profile.clerk_user_id);
    if (!user) {
      counts.skipped_no_clerk_user += 1;
      report.push([profile.email ?? "", profile.clerk_user_id, "skipped", "clerk user not found"]);
      continue;
    }

    const { email, verified, reason } = verifiedPrimary(user);
    if (!verified || !email) {
      counts.skipped_unverified += 1;
      report.push([profile.email ?? "", profile.clerk_user_id, "skipped", reason ?? "unverified"]);
      continue;
    }

    if (!APPLY) {
      // dry run: work out what WOULD happen, without writing
      const person = await postgres.query(
        `select id from app_users where lower(email) = $1`,
        [email],
      );
      if (person.rows[0]) {
        const clash = await postgres.query(
          `select provider_user_id from core.identities
            where provider='clerk' and account_id=$1`,
          [person.rows[0].id],
        );
        if (clash.rows[0] && clash.rows[0].provider_user_id !== profile.clerk_user_id) {
          counts.collision += 1;
          report.push([email, profile.clerk_user_id, "collision", "already linked to another Clerk user"]);
          continue;
        }
        counts.linked += 1;
        report.push([email, profile.clerk_user_id, "would_link", "existing person"]);
      } else {
        counts.created += 1;
        report.push([email, profile.clerk_user_id, "would_create", "new person + workspace"]);
      }
      continue;
    }

    const result = await withTransaction((client) =>
      importOne(client, { profile, clerkUser: user, email }),
    );
    counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
    report.push([email, profile.clerk_user_id, result.outcome, result.accountId ?? ""]);
  }

  log("");
  log("---- result ----");
  for (const [key, value] of Object.entries(counts)) {
    if (value) log(`  ${key.padEnd(24)} ${value}`);
  }
  const accounted =
    counts.created + counts.linked + counts.collision +
    counts.skipped_unverified + counts.skipped_no_clerk_user + counts.skipped_no_clerk_id;
  log(`  ${"TOTAL".padEnd(24)} ${accounted} of ${profiles.length}`);

  const csv = report.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const path = `/tmp/afs-import-${APPLY ? "applied" : "dryrun"}-${Date.now()}.csv`;
  writeFileSync(path, csv);
  log("");
  log(`report: ${path}`);

  if (!APPLY) {
    log("");
    log("Nothing was written. Re-run with --apply when the numbers look right.");
  }

  await postgres.end();
}

main().catch(async (error) => {
  console.error("\nimport failed:", error.message);
  try { await postgres.end(); } catch {}
  process.exit(1);
});
