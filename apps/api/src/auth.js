import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import {
  createResendAuthMailer,
  dispatchAuthEmail,
  resendAuthConfigured,
} from "./email.js";

function trustedOrigins() {
  return [
    process.env.SITE_URL,
    ...(process.env.TRUSTED_ORIGINS ?? "").split(","),
  ]
    .map((origin) => origin?.trim())
    .filter(Boolean);
}

export function authOptions(postgres) {
  const googleConfigured = Boolean(
    process.env.GOOGLE_AUTH_CLIENT_ID && process.env.GOOGLE_AUTH_CLIENT_SECRET,
  );
  const emailConfigured = resendAuthConfigured(process.env);
  const mailer = emailConfigured
    ? createResendAuthMailer({ environment: process.env })
    : undefined;

  return {
    database: postgres,
    baseURL:
      process.env.BETTER_AUTH_URL ??
      process.env.PUBLIC_API_URL ??
      "http://127.0.0.1:3001",
    basePath: "/api/auth",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    emailVerification: mailer
      ? {
          sendVerificationEmail: async ({ user, url, token }) => {
            dispatchAuthEmail(mailer.sendVerification({ user, url, token }));
          },
          sendOnSignUp: true,
          sendOnSignIn: false,
          autoSignInAfterVerification: true,
          expiresIn: 3_600,
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: emailConfigured,
      sendResetPassword: mailer
        ? async ({ user, url, token }) => {
            dispatchAuthEmail(mailer.sendPasswordReset({ user, url, token }));
          }
        : undefined,
      resetPasswordTokenExpiresIn: 3_600,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    plugins: mailer
      ? [
          magicLink({
            disableSignUp: true,
            expiresIn: 60 * 15,
            storeToken: "hashed",
            rateLimit: { window: 60, max: 3 },
            sendMagicLink: async ({ email, url, token }) => {
              const existing = await postgres.query(
                `select email, display_name
                 from app_users
                 where lower(email) = lower($1) and email_verified = true
                 limit 1`,
                [email],
              );
              const user = existing.rows[0];
              if (!user) return;
              await mailer.sendSignInLink({
                user: { email: user.email, name: user.display_name },
                url,
                token,
              });
            },
          }),
        ]
      : [],
    socialProviders: googleConfigured
      ? {
          google: {
            clientId: process.env.GOOGLE_AUTH_CLIENT_ID,
            clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
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
              if (emailConfigured && user.emailVerified === true) {
                await client.query(
                  `insert into outbox_events
                    (aggregate_type, aggregate_id, event_type, payload)
                   values ('app_user', $1, 'auth.welcome_email_requested', '{}'::jsonb)
                   on conflict do nothing`,
                  [appUserId],
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
        update: {
          after: async (user) => {
            const updated = await postgres.query(
              `update app_users
               set display_name = coalesce($2, display_name),
                   email_verified = $3,
                   image_url = coalesce($4, image_url),
                   updated_at = now()
               where auth_user_id = $1 or email = $5
               returning id`,
              [
                user.id,
                user.name,
                user.emailVerified === true,
                user.image ?? null,
                user.email,
              ],
            );
            if (emailConfigured && user.emailVerified === true) {
              for (const appUser of updated.rows) {
                await postgres.query(
                  `insert into outbox_events
                    (aggregate_type, aggregate_id, event_type, payload)
                   values ('app_user', $1, 'auth.welcome_email_requested', '{}'::jsonb)
                   on conflict do nothing`,
                  [appUser.id],
                );
              }
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
