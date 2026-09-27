import { MULTI_ACCOUNT_PLATFORMS as SEVERAL } from "@posterract/contract";

/** Instagram, Facebook and Threads posts can go to several accounts at once; other platforms to one. */
export const MULTI_ACCOUNT_PLATFORMS = new Set(SEVERAL);

class TargetError extends Error {
  constructor(code, status, details = {}) {
    super(code);
    this.statusCode = status;
    this.details = details;
  }
}

/** Explicit web targets must never fall back to another account, even in the same workspace. */
export async function loadExplicitPostAccounts(database, workspaceId, accountIds, providers) {
  const result = await database.query(`select id, provider, status from social_accounts
    where workspace_id = $1 and id = any($2::uuid[])`, [workspaceId, accountIds]);
  if (result.rows.length !== accountIds.length) throw Object.assign(new Error("account_target_unavailable"), { statusCode: 409 });
  if (result.rows.some((a) => !providers.includes(a.provider))) throw Object.assign(new Error("account_target_platform_mismatch"), { statusCode: 400 });
  return result;
}

/**
 * The accounts a new post goes to, as [{ id, provider }] in a stable order.
 * - `businessId`: every connected account in that business on the requested
 *   platforms (a disconnected one is skipped, so one dead login never blocks
 *   the business). With `accountIds` too, exactly those, and they must be in it.
 * - `accountIds` alone: exactly those accounts, all of them connected.
 * - neither: the newest connected account for each platform.
 * Each requested platform needs at least one account, and only Instagram,
 * Facebook and Threads may have more than one. Throws TargetError
 * (statusCode, message = error code, details) otherwise.
 */
export async function resolvePostTargets(database, workspaceId, { businessId, accountIds, providers }) {
  let rows;
  if (businessId) {
    const business = await database.query(
      "select id from businesses where id = $1 and workspace_id = $2",
      [businessId, workspaceId],
    );
    if (!business.rows[0]) throw new TargetError("business_not_found", 404);
    const members = await database.query(
      `select a.id, a.provider, a.status
       from business_accounts m
       join social_accounts a on a.id = m.social_account_id
       where m.business_id = $1 and a.workspace_id = $2 and a.provider = any($3::text[])
       order by m.created_at asc, a.created_at asc`,
      [businessId, workspaceId, providers],
    );
    if (accountIds) {
      const memberIds = new Set(members.rows.map((row) => row.id));
      if (accountIds.some((id) => !memberIds.has(id))) throw new TargetError("account_not_in_business", 400);
      rows = members.rows.filter((row) => accountIds.includes(row.id));
    } else {
      rows = members.rows.filter((row) => row.status === "connected");
    }
  } else if (accountIds) {
    rows = (await loadExplicitPostAccounts(database, workspaceId, accountIds, providers)).rows;
  } else {
    rows = (await database.query(
      `select distinct on (provider) id, provider, status
       from social_accounts
       where workspace_id = $1 and status = 'connected' and provider = any($2::text[])
       order by provider, updated_at desc`,
      [workspaceId, providers],
    )).rows;
  }

  const disconnected = rows.filter((row) => row.status !== "connected");
  const connected = rows.filter((row) => row.status === "connected");
  const missing = providers.filter((provider) => !connected.some((row) => row.provider === provider));
  const unavailable = [...new Set([...disconnected.map((row) => row.provider), ...missing])];
  if (unavailable.length > 0) throw new TargetError("account_not_connected", 409, { platforms: unavailable });
  const crowded = providers.filter(
    (provider) => !MULTI_ACCOUNT_PLATFORMS.has(provider) && connected.filter((row) => row.provider === provider).length > 1,
  );
  if (crowded.length > 0) throw new TargetError("one_account_per_platform", 400, { platforms: crowded });
  return connected.map((row) => ({ id: row.id, provider: row.provider }));
}
