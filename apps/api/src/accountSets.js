import { randomUUID } from "node:crypto";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function loadAccountSets(database, workspaceId) {
  const sets = await database.query(
    `select id, workspace_id, name, created_at, updated_at
     from account_sets
     where workspace_id = $1
     order by updated_at desc, name asc`,
    [workspaceId],
  );
  if (sets.rows.length === 0) return [];
  const members = await database.query(
    `select m.account_set_id, a.id as account_id, a.workspace_id, a.provider,
            a.provider_account_id, a.handle, a.display_name, a.avatar_url,
            a.status, a.scopes, a.token_expires_at, a.last_health_check_at,
            a.metadata
     from account_set_members m
     join social_accounts a on a.id = m.social_account_id
     where m.account_set_id = any($1::uuid[])
     order by m.created_at asc`,
    [sets.rows.map((row) => row.id)],
  );
  const accountsBySet = new Map();
  for (const row of members.rows) {
    const accounts = accountsBySet.get(row.account_set_id) ?? [];
    accounts.push(portalFromRow(row));
    accountsBySet.set(row.account_set_id, accounts);
  }
  return sets.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    accounts: accountsBySet.get(row.id) ?? [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  }));
}

function parseAccountSetBody(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const accountIds = Array.isArray(body?.accountIds)
    ? [...new Set(body.accountIds)]
    : [];
  if (!name || name.length > 80) return { error: "invalid_account_set_name" };
  if (
    accountIds.length === 0 ||
    accountIds.length > 6 ||
    accountIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))
  ) {
    return { error: "invalid_account_set_accounts" };
  }
  return { name, accountIds };
}

async function writeAccountSet(database, workspaceId, setId, input, creating) {
  const client = await database.connect();
  try {
    await client.query("begin");
    await client.query("select id from workspaces where id = $1 for update", [workspaceId]);
    const accounts = await client.query(
      `select id, provider
       from social_accounts
       where workspace_id = $1 and id = any($2::uuid[]) and status = 'connected'
       order by created_at asc`,
      [workspaceId, input.accountIds],
    );
    if (accounts.rows.length !== input.accountIds.length) {
      const error = new Error("account_set_account_unavailable");
      error.code = "account_set_account_unavailable";
      throw error;
    }
    const providers = accounts.rows.map((row) => row.provider);
    if (new Set(providers).size !== providers.length) {
      const error = new Error("account_set_duplicate_provider");
      error.code = "account_set_duplicate_provider";
      throw error;
    }

    if (creating) {
      await client.query(
        `insert into account_sets (id, workspace_id, name)
         values ($1, $2, $3)`,
        [setId, workspaceId, input.name],
      );
    } else {
      const updated = await client.query(
        `update account_sets set name = $3, updated_at = now()
         where id = $1 and workspace_id = $2
         returning id`,
        [setId, workspaceId, input.name],
      );
      if (!updated.rows[0]) {
        const error = new Error("account_set_not_found");
        error.code = "account_set_not_found";
        throw error;
      }
      await client.query("delete from account_set_members where account_set_id = $1", [setId]);
    }

    for (const account of accounts.rows) {
      await client.query(
        `insert into account_set_members
          (account_set_id, social_account_id, provider)
         values ($1, $2, $3)`,
        [setId, account.id, account.provider],
      );
    }
    await client.query(
      "update account_sets set updated_at = now() where id = $1",
      [setId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function accountSetError(reply, error) {
  if (error?.code === "23505") {
    return reply.code(409).send({ error: "account_set_name_in_use" });
  }
  if (error?.code === "account_set_not_found") {
    return reply.code(404).send({ error: error.code });
  }
  if (["account_set_account_unavailable", "account_set_duplicate_provider"].includes(error?.code)) {
    return reply.code(409).send({ error: error.code });
  }
  throw error;
}

export function registerAccountSetRoutes(
  app,
  { postgres, requireScope, requiredWorkspace },
) {
  app.get(
    "/v1/account-sets",
    { preHandler: requireScope("accounts:read") },
    async (request) => ({
      accountSets: await loadAccountSets(postgres, requiredWorkspace(request)),
    }),
  );

  app.post(
    "/v1/account-sets",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const input = parseAccountSetBody(request.body);
      if (input.error) return reply.code(400).send({ error: input.error });
      const workspaceId = requiredWorkspace(request);
      const setId = randomUUID();
      try {
        await writeAccountSet(postgres, workspaceId, setId, input, true);
      } catch (error) {
        return accountSetError(reply, error);
      }
      const sets = await loadAccountSets(postgres, workspaceId);
      return reply.code(201).send(sets.find((set) => set.id === setId));
    },
  );

  app.put(
    "/v1/account-sets/:id",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const input = parseAccountSetBody(request.body);
      if (input.error || !uuidPattern.test(request.params.id)) {
        return reply.code(400).send({ error: input.error ?? "invalid_account_set_id" });
      }
      const workspaceId = requiredWorkspace(request);
      try {
        await writeAccountSet(postgres, workspaceId, request.params.id, input, false);
      } catch (error) {
        return accountSetError(reply, error);
      }
      const sets = await loadAccountSets(postgres, workspaceId);
      return sets.find((set) => set.id === request.params.id);
    },
  );

  app.delete(
    "/v1/account-sets/:id",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      const deleted = await postgres.query(
        `delete from account_sets where id = $1 and workspace_id = $2 returning id`,
        [request.params.id, requiredWorkspace(request)],
      );
      if (!deleted.rows[0]) return reply.code(404).send({ error: "account_set_not_found" });
      return reply.code(204).send();
    },
  );
}
