/**
 * Person + workspace provisioning.
 *
 * Mirrors the better-auth signup hook in apps/api/src/auth.js so a person
 * created from the AI FOR SAVAGES side lands in exactly the same shape
 * Posterract expects (workspace, owner membership, six social placeholders).
 *
 * Two deliberate differences, both from §3/§10:
 *   - `auth_user_id` is NOT set. That belongs to better-auth; it gets filled
 *     in if and when the person signs in to Posterract.
 *   - `email_verified` is NOT set. That is Posterract's own flag and only
 *     Posterract's login may set it. Clerk-side verification is recorded on
 *     core.identities.verified_at instead.
 *
 * NOTE: this duplicates the hook's SQL rather than importing it. Extracting a
 * shared package touches Posterract's live signup path, so that refactor is
 * deliberately deferred until the Hub is proven in production. If the hook
 * changes, change this too.
 */

const SOCIAL_PROVIDERS = [
  "instagram",
  "tiktok",
  "facebook",
  "threads",
  "x",
  "youtube",
];

/** Give a person a workspace, owner membership and social placeholders. */
export async function provisionWorkspace(client, accountId, label) {
  const existing = await client.query(
    `select id from workspaces where owner_id = $1 limit 1`,
    [accountId],
  );

  let workspaceId = existing.rows[0]?.id;
  if (!workspaceId) {
    const created = await client.query(
      `insert into workspaces (id, owner_id, name)
       values (gen_random_uuid(), $1, $2)
       returning id`,
      [accountId, `${label}'s workspace`],
    );
    workspaceId = created.rows[0].id;
  }

  await client.query(
    `insert into workspace_memberships (workspace_id, user_id, role)
     values ($1, $2, 'owner')
     on conflict (workspace_id, user_id) do update set role = 'owner'`,
    [workspaceId, accountId],
  );

  for (const provider of SOCIAL_PROVIDERS) {
    await client.query(
      `insert into social_accounts (workspace_id, provider, handle, status)
       select $1, $2, 'not connected', 'disconnected'
       where not exists (
         select 1 from social_accounts
         where workspace_id = $1 and provider = $2
       )`,
      [workspaceId, provider],
    );
  }

  return workspaceId;
}

/**
 * Find a person by verified, lower-cased email, or create them.
 * Never merges anything — callers handle collisions.
 */
export async function findOrCreatePerson(client, { email, displayName, imageUrl }) {
  const found = await client.query(
    `select id from app_users where lower(email) = $1 limit 1`,
    [email],
  );
  if (found.rows[0]) {
    return { accountId: found.rows[0].id, created: false };
  }

  const created = await client.query(
    `insert into app_users (id, email, display_name, image_url)
     values (gen_random_uuid(), $1, $2, $3)
     on conflict (email) do update
       set display_name = coalesce(excluded.display_name, app_users.display_name),
           image_url    = coalesce(excluded.image_url, app_users.image_url),
           updated_at   = now()
     returning id`,
    [email, displayName ?? null, imageUrl ?? null],
  );

  const accountId = created.rows[0].id;
  await provisionWorkspace(client, accountId, displayName || email);
  return { accountId, created: true };
}

/** Park something a human has to decide. Never auto-resolve an identity clash. */
export async function queueReview(client, kind, accountId, details) {
  await client.query(
    `insert into core.review_queue (kind, account_id, details)
     values ($1, $2, $3::jsonb)`,
    [kind, accountId ?? null, JSON.stringify(details ?? {})],
  );
}
