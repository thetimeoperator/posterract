/** Reading and saving businesses and the accounts in them. */

import { logoUrl } from "./logo.js";

export const MAX_BUSINESS_ACCOUNTS = 60;
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BusinessError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function portalFromRow(row) {
  return {
    id: row.account_id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id ?? "",
    handle: row.handle,
    displayName: row.display_name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    scopes: row.scopes ?? [],
    status: row.status,
    tokenExpiresAt: row.token_expires_at
      ? new Date(row.token_expires_at).getTime()
      : undefined,
    lastHealthCheckAt: row.last_health_check_at
      ? new Date(row.last_health_check_at).getTime()
      : undefined,
    windowUsage: row.metadata?.windowUsage,
  };
}

/** Every business in a workspace, alphabetically, with its accounts. */
export async function loadBusinesses(database, workspaceId, { publicApiUrl }) {
  const businesses = await database.query(
    `select id, workspace_id, name, logo_hash, created_at, updated_at
     from businesses
     where workspace_id = $1
     order by lower(name) asc, created_at asc`,
    [workspaceId],
  );
  if (businesses.rows.length === 0) return [];
  const members = await database.query(
    `select m.business_id, a.id as account_id, a.workspace_id, a.provider,
            a.provider_account_id, a.handle, a.display_name, a.avatar_url,
            a.status, a.scopes, a.token_expires_at, a.last_health_check_at,
            a.metadata
     from business_accounts m
     join social_accounts a on a.id = m.social_account_id
     where m.business_id = any($1::uuid[])
     order by m.created_at asc, a.created_at asc`,
    [businesses.rows.map((row) => row.id)],
  );
  const accountsByBusiness = new Map();
  for (const row of members.rows) {
    const accounts = accountsByBusiness.get(row.business_id) ?? [];
    accounts.push(portalFromRow(row));
    accountsByBusiness.set(row.business_id, accounts);
  }
  return businesses.rows.map((row) => {
    const accounts = accountsByBusiness.get(row.id) ?? [];
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      logoUrl: logoUrl(publicApiUrl, row.logo_hash),
      accountIds: accounts.map((account) => account.id),
      accounts,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  });
}

/**
 * Creates a business, or replaces an existing one's name and accounts.
 * `input.logo`: undefined keeps the logo, null removes it, a parsed logo sets it.
 * New accounts must be connected; an account already in the business may stay
 * even while it is disconnected, so saving never drops it silently.
 */
export async function saveBusiness(database, workspaceId, businessId, input, { creating }) {
  const client = await database.connect();
  try {
    await client.query("begin");
    await client.query("select id from workspaces where id = $1 for update", [workspaceId]);
    const current = creating
      ? { rows: [] }
      : await client.query(
          `select m.social_account_id
           from business_accounts m join businesses b on b.id = m.business_id
           where b.id = $1 and b.workspace_id = $2`,
          [businessId, workspaceId],
        );
    const members = new Set(current.rows.map((row) => row.social_account_id));
    if (input.accountIds.length > 0) {
      const accounts = await client.query(
        `select id, status from social_accounts
         where workspace_id = $1 and id = any($2::uuid[])`,
        [workspaceId, input.accountIds],
      );
      const usable = accounts.rows.filter((row) => row.status === "connected" || members.has(row.id));
      if (usable.length !== input.accountIds.length) {
        throw new BusinessError("business_account_unavailable", 409);
      }
    }

    if (creating) {
      await client.query(
        `insert into businesses (id, workspace_id, name, logo, logo_type, logo_hash)
         values ($1, $2, $3, $4, $5, $6)`,
        [businessId, workspaceId, input.name, input.logo?.bytes ?? null, input.logo?.type ?? null, input.logo?.hash ?? null],
      );
    } else {
      const updated = await client.query(
        input.logo === undefined
          ? `update businesses set name = $3, updated_at = now()
             where id = $1 and workspace_id = $2 returning id`
          : `update businesses set name = $3, logo = $4, logo_type = $5, logo_hash = $6, updated_at = now()
             where id = $1 and workspace_id = $2 returning id`,
        input.logo === undefined
          ? [businessId, workspaceId, input.name]
          : [businessId, workspaceId, input.name, input.logo?.bytes ?? null, input.logo?.type ?? null, input.logo?.hash ?? null],
      );
      if (!updated.rows[0]) throw new BusinessError("business_not_found", 404);
      await client.query("delete from business_accounts where business_id = $1", [businessId]);
    }

    for (const accountId of input.accountIds) {
      await client.query(
        "insert into business_accounts (business_id, social_account_id) values ($1, $2)",
        [businessId, accountId],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error?.code === "23505") throw new BusinessError("business_name_in_use", 409);
    throw error;
  } finally {
    client.release();
  }
}

/** Deletes a business. Its accounts and posts stay; the posts just lose its logo. */
export async function deleteBusiness(database, workspaceId, businessId) {
  const deleted = await database.query(
    "delete from businesses where id = $1 and workspace_id = $2 returning id",
    [businessId, workspaceId],
  );
  return Boolean(deleted.rows[0]);
}
