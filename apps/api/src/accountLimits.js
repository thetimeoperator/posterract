/**
 * How many social accounts a workspace may connect, across every platform.
 *
 *   Pro ($20 a month or $200 a year)                      10 accounts
 *   the workspace owner is an AI FOR SAVAGES member       100 accounts
 *
 * "Member" is the rule billing.js uses for access: the owner's email is
 * verified and core.has_membership says yes.
 *
 * A slot is any real account that is not disconnected: connected, or waiting
 * for a reconnect (needs_reauth). The empty per-platform placeholders a
 * workspace starts with never take one.
 *
 * The limit is checked only when an account would take a NEW slot, so
 * reconnecting an account that already holds one always works. A workspace
 * already over its limit keeps every account; it just cannot add one until
 * it is under.
 */

export const ACCOUNT_LIMITS = Object.freeze({ pro: 10, aiforsavages: 100 });

/** "aiforsavages" when the workspace owner is a member, otherwise "pro". */
export async function accountPlanFor(db, workspaceId) {
  try {
    const result = await db.query(
      `select exists (
         select 1
         from workspaces w
         join app_users u on u.id = w.owner_id
         where w.id = $1
           and u.email_verified = true
           and core.has_membership(u.id, 'aiforsavages')
       ) as member`,
      [workspaceId],
    );
    return result.rows[0]?.member === true ? "aiforsavages" : "pro";
  } catch {
    // The core schema is missing or unreadable: Pro's limit stands, the same
    // fallback billing.js uses for access.
    return "pro";
  }
}

/** Accounts holding a slot right now. */
export async function usedAccountSlots(db, workspaceId) {
  const result = await db.query(
    `select count(*)::int as used
     from social_accounts
     where workspace_id = $1
       and provider_account_id is not null
       and status <> 'disconnected'`,
    [workspaceId],
  );
  return Number(result.rows[0]?.used ?? 0);
}

/** The workspace's limit as the web app and the API show it. */
export async function accountLimitFor(db, workspaceId) {
  const [plan, used] = await Promise.all([
    accountPlanFor(db, workspaceId),
    usedAccountSlots(db, workspaceId),
  ]);
  return { plan, max: ACCOUNT_LIMITS[plan], used };
}

export class AccountLimitError extends Error {
  constructor(limit) {
    super(
      limit.plan === "aiforsavages"
        ? `All ${limit.max} of your account slots are in use. Disconnect an account to add another.`
        : `Pro connects up to ${limit.max} accounts, and all ${limit.max} are in use. Disconnect one to add another, or join AI FOR SAVAGES to connect up to ${ACCOUNT_LIMITS.aiforsavages}.`,
    );
    this.name = "AccountLimitError";
    this.code = "account_limit_reached";
    this.accountLimit = limit;
  }
}
