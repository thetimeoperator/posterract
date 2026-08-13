import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";

function trustedOrigins() {
  return [
    process.env.SITE_URL,
    ...(process.env.TRUSTED_ORIGINS ?? "").split(","),
  ]
    .map((origin) => origin?.trim())
    .filter(Boolean);
}

export function authOptions(postgres) {
  return {
    database: postgres,
    baseURL:
      process.env.BETTER_AUTH_URL ??
      process.env.PUBLIC_API_URL ??
      "http://127.0.0.1:3001",
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const client = await postgres.connect();
            try {
              await client.query("begin");
              const appUser = await client.query(
                `insert into app_users
                  (id, auth_user_id, email, display_name, email_verified, image_url)
                 values ($1, $2, $3, $4, $5, $6)
                 on conflict (email) do update
                 set auth_user_id = excluded.auth_user_id,
                     display_name = coalesce(excluded.display_name, app_users.display_name),
                     email_verified = excluded.email_verified,
                     image_url = coalesce(excluded.image_url, app_users.image_url),
                     updated_at = now()
                 returning id`,
                [
                  randomUUID(),
                  user.id,
                  user.email,
                  user.name,
                  user.emailVerified === true,
                  user.image ?? null,
                ],
              );
              const appUserId = appUser.rows[0].id;
              const existing = await client.query(
                `select id from workspaces where owner_id = $1 limit 1`,
                [appUserId],
              );
              const workspaceId = existing.rows[0]?.id ?? randomUUID();
              if (!existing.rows[0]) {
                await client.query(
                  `insert into workspaces (id, owner_id, name)
                   values ($1, $2, $3)`,
                  [workspaceId, appUserId, `${user.name || user.email}'s workspace`],
                );
              }
              await client.query(
                `insert into workspace_memberships (workspace_id, user_id, role)
                 values ($1, $2, 'owner')
                 on conflict (workspace_id, user_id) do update set role = 'owner'`,
                [workspaceId, appUserId],
              );
              for (const provider of [
                "instagram",
                "tiktok",
                "facebook",
                "threads",
                "x",
                "youtube",
              ]) {
                await client.query(
                  `insert into social_accounts
                    (workspace_id, provider, handle, status)
                   values ($1, $2, 'not connected', 'disconnected')
                   on conflict (workspace_id, provider) do nothing`,
                  [workspaceId, provider],
                );
              }
              await client.query("commit");
            } catch (error) {
              await client.query("rollback");
              throw error;
            } finally {
              client.release();
            }
          },
        },
      },
    },
  };
}

export function createPosterractAuth(postgres) {
  if (!process.env.BETTER_AUTH_SECRET) return undefined;
  return betterAuth(authOptions(postgres));
}
