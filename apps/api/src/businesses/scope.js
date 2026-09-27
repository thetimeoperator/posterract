/**
 * Which accounts a read covers: every connected account (the overall view),
 * the accounts in one business, or accounts picked one by one — alone or
 * inside a business. Analytics and the Muse connector share this, so a
 * business or account filter means the same thing everywhere.
 */

import { BusinessError, uuidPattern } from "./store.js";

/** `?business=<id>&accounts=<id>,<id>` → { businessId?, accountIds? }, or throws invalid_scope. */
export function parseScopeQuery(query = {}) {
  const businessId = typeof query.business === "string" && query.business ? query.business : undefined;
  const raw = typeof query.accounts === "string" && query.accounts ? query.accounts.split(",") : undefined;
  const accountIds = raw ? [...new Set(raw.map((id) => id.trim()).filter(Boolean))] : undefined;
  if (businessId && !uuidPattern.test(businessId)) throw new BusinessError("invalid_scope", 400);
  if (accountIds && (accountIds.length === 0 || accountIds.length > 100 || accountIds.some((id) => !uuidPattern.test(id)))) {
    throw new BusinessError("invalid_scope", 400);
  }
  return { businessId, accountIds };
}

/**
 * The connected account ids a scope covers, or null for "every connected
 * account" (no filter). Accounts picked inside a business must belong to it.
 */
export async function resolveScopeAccounts(database, workspaceId, { businessId, accountIds }) {
  if (!businessId && !accountIds) return null;
  if (businessId) {
    const business = await database.query(
      "select id from businesses where id = $1 and workspace_id = $2",
      [businessId, workspaceId],
    );
    if (!business.rows[0]) throw new BusinessError("business_not_found", 404);
  }
  const result = await database.query(
    `select a.id from social_accounts a
     where a.workspace_id = $1 and a.status = 'connected'
       and ($2::uuid is null or exists (
         select 1 from business_accounts m where m.business_id = $2 and m.social_account_id = a.id))
       and ($3::uuid[] is null or a.id = any($3::uuid[]))`,
    [workspaceId, businessId ?? null, accountIds ?? null],
  );
  if (accountIds && result.rows.length !== accountIds.length) throw new BusinessError("invalid_scope", 400);
  return result.rows.map((row) => row.id);
}
