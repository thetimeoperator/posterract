/** Explicit web targets must never fall back to another account, even in the same workspace. */
export async function loadExplicitPostAccounts(database, workspaceId, accountIds, providers) {
  const result = await database.query(`select id, provider, status from social_accounts
    where workspace_id = $1 and id = any($2::uuid[])`, [workspaceId, accountIds]);
  if (result.rows.length !== accountIds.length) throw Object.assign(new Error("account_target_unavailable"), { statusCode: 409 });
  if (result.rows.some((a) => !providers.includes(a.provider))) throw Object.assign(new Error("account_target_platform_mismatch"), { statusCode: 400 });
  return result;
}
