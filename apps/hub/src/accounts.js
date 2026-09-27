import { postgres, withTransaction } from "./db.js";
import { findOrCreatePerson, queueReview } from "./provisioning.js";
import { serverUrl } from "./discord.js";

/**
 * Attach a Clerk login to a person, creating the person if needed.
 *
 * THE rule (§3): a person is one row in app_users keyed by a lower-cased,
 * VERIFIED email. Linking happens only when the email is verified on the side
 * doing the linking — here, verified by Clerk's own Backend API.
 *
 * Never auto-merges. Any collision parks a review_queue row and changes
 * nothing.
 *
 * Idempotent: calling it repeatedly for the same Clerk user is a no-op.
 */
export async function resolveAccount({
  clerkUserId,
  email,
  verified,
  displayName,
  imageUrl,
}) {
  if (!verified || !email) {
    return { ok: false, reason: "email_not_verified" };
  }

  return withTransaction(async (client) => {
    // ---- 1. already linked? -------------------------------------------
    const identity = await client.query(
      `select id, account_id, email
         from core.identities
        where provider = 'clerk' and provider_user_id = $1`,
      [clerkUserId],
    );

    if (identity.rows[0]) {
      const row = identity.rows[0];

      // email unchanged — nothing to do
      if (row.email === email) {
        return { ok: true, accountId: row.account_id, action: "existing" };
      }

      // the Clerk email changed. If the new address already belongs to a
      // DIFFERENT person, stop — this is exactly the merge we must never do.
      const other = await client.query(
        `select id from app_users where lower(email) = $1 limit 1`,
        [email],
      );
      if (other.rows[0] && other.rows[0].id !== row.account_id) {
        await queueReview(client, "identity_email_collision", row.account_id, {
          clerkUserId,
          fromEmail: row.email,
          toEmail: email,
          conflictsWithAccountId: other.rows[0].id,
        });
        return { ok: false, reason: "collision", accountId: row.account_id };
      }

      await client.query(
        `update core.identities
            set email = $1, verified_at = now(), updated_at = now()
          where id = $2`,
        [email, row.id],
      );
      return { ok: true, accountId: row.account_id, action: "email_updated" };
    }

    // ---- 2. not linked yet: find or create the person ------------------
    const existing = await client.query(
      `select id from app_users where lower(email) = $1 limit 1`,
      [email],
    );

    let accountId;
    if (existing.rows[0]) {
      accountId = existing.rows[0].id;

      // is this person already holding a different Clerk login?
      const clash = await client.query(
        `select provider_user_id
           from core.identities
          where provider = 'clerk' and account_id = $1`,
        [accountId],
      );
      if (clash.rows[0] && clash.rows[0].provider_user_id !== clerkUserId) {
        await queueReview(client, "identity_account_already_linked", accountId, {
          email,
          incomingClerkUserId: clerkUserId,
          existingClerkUserId: clash.rows[0].provider_user_id,
        });
        return { ok: false, reason: "collision", accountId };
      }
    } else {
      const created = await findOrCreatePerson(client, {
        email,
        displayName,
        imageUrl,
      });
      accountId = created.accountId;
    }

    await client.query(
      `insert into core.identities
         (account_id, provider, provider_user_id, email, verified_at)
       values ($1, 'clerk', $2, $3, now())
       on conflict (provider, provider_user_id) do update
         set email = excluded.email,
             verified_at = excluded.verified_at,
             updated_at = now()`,
      [accountId, clerkUserId, email],
    );

    return {
      ok: true,
      accountId,
      action: existing.rows[0] ? "linked_existing" : "created",
    };
  });
}

/**
 * Everything the website needs to decide what is unlocked.
 * This is the ONLY source of truth for entitlement on the AFS side.
 */
export async function buildMe(accountId) {
  const [account, memberships, products, profile, discord] = await Promise.all([
    postgres.query(
      `select id, email, display_name, image_url, email_verified, created_at
         from app_users where id = $1`,
      [accountId],
    ),
    postgres.query(
      `select product_id, plan, status, source,
              current_period_start, current_period_end,
              cancel_at_period_end, grace_until, member_since,
              (extract(year from age(now(), member_since)) * 12
               + extract(month from age(now(), member_since)))::int as streak_months
         from core.memberships
        where account_id = $1
        order by created_at desc`,
      [accountId],
    ),
    postgres.query(`select id, member_base_plan from core.products order by id`),
    postgres.query(
      // named columns on purpose: the sealed GitHub token (020) must never
      // leave the Hub, not even encrypted
      `select account_id, handle, show_on_wall, main_project_name, main_project_url,
              github_login, github_user_id, github_connected_at,
              (github_token_enc is not null) as github_connected,
              created_at, updated_at
         from afs.profiles where account_id = $1`,
      [accountId],
    ),
    postgres.query(
      `select discord_user_id, discord_username, in_guild, role
         from core.discord_links where account_id = $1`,
      [accountId],
    ),
  ]);

  if (!account.rows[0]) return null;

  const afs = await postgres.query(
    `select core.has_membership($1, 'aiforsavages') as ok`,
    [accountId],
  );
  const isAfsMember = afs.rows[0]?.ok === true;

  // AI FOR SAVAGES is the core product; an active membership includes the base
  // plan of every product flagged member_base_plan. A product's OWN paid
  // subscription is checked by that product, not here.
  const entitlements = {};
  for (const product of products.rows) {
    entitlements[product.id] =
      product.id === "aiforsavages"
        ? isAfsMember
        : product.member_base_plan === true && isAfsMember;
  }

  const live = memberships.rows.find(
    (row) => row.status === "active" || row.status === "past_due",
  );

  return {
    account: {
      id: account.rows[0].id,
      email: account.rows[0].email,
      displayName: account.rows[0].display_name,
      imageUrl: account.rows[0].image_url,
      // Posterract's own flag — gates Posterract access via membership (§7)
      emailVerified: account.rows[0].email_verified,
      createdAt: account.rows[0].created_at,
    },
    memberships: memberships.rows,
    entitlements,
    // months elapsed on the current unbroken membership, so a yearly payer
    // does not show a single moon
    memberStreakMonths: live?.streak_months ?? 0,
    profile: profile.rows[0] ?? null,
    discord: discord.rows[0] ? { ...discord.rows[0], serverUrl: serverUrl() } : null,
  };
}

/** Look up the person behind a Clerk login without creating anything. */
export async function accountIdForClerkUser(clerkUserId) {
  const found = await postgres.query(
    `select account_id from core.identities
      where provider = 'clerk' and provider_user_id = $1`,
    [clerkUserId],
  );
  return found.rows[0]?.account_id ?? null;
}
