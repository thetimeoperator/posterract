import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth.js";
import { loadAnalyticsDashboard } from "../src/analytics.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(
  here,
  "../../../deploy/posterract/postgres/init",
);

test("Google authentication is exposed only when both OAuth credentials exist", () => {
  const previousClientId = process.env.GOOGLE_AUTH_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET;
  try {
    delete process.env.GOOGLE_AUTH_CLIENT_ID;
    delete process.env.GOOGLE_AUTH_CLIENT_SECRET;
    assert.deepEqual(authOptions({}).socialProviders, {});

    process.env.GOOGLE_AUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_AUTH_CLIENT_SECRET = "google-client-secret";
    const google = authOptions({}).socialProviders.google;
    assert.equal(google.clientId, "google-client-id");
    assert.equal(google.clientSecret, "google-client-secret");
    assert.equal(google.prompt, "select_account");
  } finally {
    if (previousClientId === undefined) delete process.env.GOOGLE_AUTH_CLIENT_ID;
    else process.env.GOOGLE_AUTH_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GOOGLE_AUTH_CLIENT_SECRET;
    else process.env.GOOGLE_AUTH_CLIENT_SECRET = previousClientSecret;
  }
});

test("authentication remembers browsers and never verifies on sign-in", () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.RESEND_FROM_EMAIL;
  try {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Posterract <security@posterract.app>";
    const options = authOptions({});
    assert.equal(options.emailVerification?.sendOnSignIn, false);
    assert.equal(options.session.expiresIn, 60 * 60 * 24 * 30);
    assert.equal(options.session.updateAge, 60 * 60 * 24);
    assert.equal(options.plugins[0]?.id, "magic-link");
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previousFrom;
  }
});

test("PostgreSQL application migrations apply cleanly and idempotently", async () => {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const migrations = await Promise.all(
    ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql", "004-agent-chats.sql", "005-tiktok-draft-status.sql", "006-stripe-billing.sql", "007-welcome-email.sql", "008-creative-editor.sql", "009-desktop-auth.sql", "010-account-sets.sql"].map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationDirectory, name), "utf8"),
    })),
  );

  try {
    for (const migration of migrations) await postgres.exec(migration.sql);
    for (const migration of migrations) await postgres.exec(migration.sql);

    const tables = await postgres.query(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'`,
    );
    const names = new Set(tables.rows.map((row) => row.table_name));
    for (const required of [
      "app_users",
      "workspaces",
      "social_accounts",
      "social_account_tokens",
      "media_assets",
      "transmissions",
      "projections",
      "outbox_events",
      "api_keys",
      "api_idempotency_keys",
      "api_audit_logs",
      "meta_deletion_requests",
      "agent_credentials",
      "agent_runs",
      "agent_chats",
      "agent_chat_messages",
      "billing_customers",
      "billing_subscriptions",
      "billing_checkout_sessions",
      "stripe_webhook_events",
      "creative_projects",
      "creative_project_revisions",
      "creative_project_revision_files",
      "creative_operations",
      "creative_project_assets",
      "creative_project_asset_manifests",
      "desktop_authorization_grants",
      "desktop_devices",
      "desktop_access_tokens",
      "desktop_refresh_tokens",
      "account_sets",
      "account_set_members",
    ]) {
      assert.equal(names.has(required), true, `${required} table is missing`);
    }

    const accountIndexes = await postgres.query(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'social_accounts'`,
    );
    assert.equal(
      accountIndexes.rows.some(
        (row) => row.indexname === "social_accounts_workspace_provider_account_idx",
      ),
      true,
    );
    assert.equal(
      accountIndexes.rows.some(
        (row) => row.indexname === "social_accounts_one_provider_per_workspace_idx",
      ),
      false,
    );
    const userColumns = await postgres.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'app_users'`,
    );
    assert.equal(
      userColumns.rows.some(
        (row) => row.column_name === "welcome_email_sent_at",
      ),
      true,
    );
    const outboxIndexes = await postgres.query(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'outbox_events'`,
    );
    assert.equal(
      outboxIndexes.rows.some(
        (row) => row.indexname === "outbox_one_welcome_email_per_user_idx",
      ),
      true,
    );
  } finally {
    await postgres.close();
  }
});

test("verified users queue exactly one welcome email", async () => {
  const previous = {
    resendKey: process.env.RESEND_API_KEY,
    resendFrom: process.env.RESEND_FROM_EMAIL,
    url: process.env.BETTER_AUTH_URL,
  };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Posterract <security@posterract.app>";
  process.env.BETTER_AUTH_URL = "https://www.posterract.app";
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const query = async (text, parameters = []) => {
    const result = await postgres.query(text, parameters);
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  };

  try {
    for (const name of [
      "001-posterract.sql",
      "002-postgres-cutover.sql",
      "007-welcome-email.sql",
    ]) {
      await postgres.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
    }
    const appUserId = "00000000-0000-4000-8000-000000000071";
    const authUserId = "auth-user-welcome";
    await query(
      `insert into app_users (id, auth_user_id, email, email_verified)
       values ($1, $2, 'welcome@example.test', false)`,
      [appUserId, authUserId],
    );
    const hook = authOptions({ query }).databaseHooks.user.update.after;
    const verifiedUser = {
      id: authUserId,
      email: "welcome@example.test",
      name: "Welcome Creator",
      emailVerified: true,
      image: null,
    };
    await hook(verifiedUser);
    await hook(verifiedUser);

    const queued = await query(
      `select count(*)::int as count
       from outbox_events
       where aggregate_id = $1 and event_type = 'auth.welcome_email_requested'`,
      [appUserId],
    );
    assert.equal(queued.rows[0].count, 1);
  } finally {
    await postgres.close();
    if (previous.resendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resendKey;
    if (previous.resendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.resendFrom;
    if (previous.url === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previous.url;
  }
});

test("PostgreSQL Better Auth creates a complete Posterract workspace", async () => {
  const previous = {
    secret: process.env.BETTER_AUTH_SECRET,
    url: process.env.BETTER_AUTH_URL,
    site: process.env.SITE_URL,
  };
  process.env.BETTER_AUTH_SECRET = "test-secret-long-enough-for-validation";
  process.env.BETTER_AUTH_URL = "http://localhost:3001";
  process.env.SITE_URL = "http://localhost:5173";
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const query = async (text, parameters = []) => {
    const result = await postgres.query(
      typeof text === "object" ? text.text : text,
      typeof text === "object" ? text.values ?? [] : parameters,
    );
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  };
  const pool = {
    query,
    connect: async () => ({ query, release() {} }),
  };

  try {
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql", "004-agent-chats.sql", "005-tiktok-draft-status.sql", "006-stripe-billing.sql", "007-welcome-email.sql"]) {
      await postgres.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
    }
    const migrations = await getMigrations(authOptions(pool));
    await migrations.runMigrations();
    const auth = betterAuth(authOptions(pool));
    const signup = await auth.api.signUpEmail({
      body: {
        name: "Posterract Test",
        email: "postgres-auth@example.test",
        password: "correct horse battery staple",
      },
    });
    assert.equal(Boolean(signup?.user?.id), true);
    const workspace = await query(
      `select w.id
       from workspaces w
       join app_users u on u.id = w.owner_id
       where u.email = $1`,
      ["postgres-auth@example.test"],
    );
    assert.equal(workspace.rows.length, 1);
    const accounts = await query(
      `select provider from social_accounts
       where workspace_id = $1 order by provider`,
      [workspace.rows[0].id],
    );
    assert.equal(accounts.rows.length, 6);
    const signin = await auth.api.signInEmail({
      body: {
        email: "postgres-auth@example.test",
        password: "correct horse battery staple",
      },
    });
    assert.equal(Boolean(signin?.user?.id), true);
    assert.equal(Boolean(signin?.token), true);
  } finally {
    await postgres.close();
    if (previous.secret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previous.secret;
    if (previous.url === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = previous.url;
    if (previous.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previous.site;
  }
});

test("analytics reads normalized PostgreSQL snapshot history", async () => {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const userId = "00000000-0000-4000-8000-000000000001";
  const workspaceId = "00000000-0000-4000-8000-000000000002";
  const accountId = "00000000-0000-4000-8000-000000000003";
  const mediaId = "00000000-0000-4000-8000-000000000004";
  const transmissionId = "00000000-0000-4000-8000-000000000005";
  const projectionId = "00000000-0000-4000-8000-000000000006";
  try {
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql", "004-agent-chats.sql", "005-tiktok-draft-status.sql", "006-stripe-billing.sql", "007-welcome-email.sql"]) {
      await postgres.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
    }
    await postgres.query(
      `insert into app_users (id, email) values ($1, 'analytics@example.test')`,
      [userId],
    );
    await postgres.query(
      `insert into workspaces (id, owner_id, name) values ($1, $2, 'Analytics')`,
      [workspaceId, userId],
    );
    await postgres.query(
      `insert into social_accounts
        (id, workspace_id, provider, provider_account_id, handle, status, scopes)
       values ($1, $2, 'instagram', 'ig-1', '@analytics', 'connected', $3)`,
      [
        accountId,
        workspaceId,
        ["instagram_business_basic", "instagram_business_manage_insights"],
      ],
    );
    await postgres.query(
      `insert into media_assets
        (id, workspace_id, original_filename, r2_key, mime_type, size_bytes, status)
       values ($1, $2, 'video.mp4', 'test/video.mp4', 'video/mp4', 100, 'attached')`,
      [mediaId, workspaceId],
    );
    await postgres.query(
      `insert into transmissions
        (id, workspace_id, media_asset_id, title, status, schedule_mode,
         scheduled_for, source)
       values ($1, $2, $3, 'Analytics post', 'live', 'now', now(), 'ui')`,
      [transmissionId, workspaceId, mediaId],
    );
    await postgres.query(
      `insert into projections
        (id, transmission_id, workspace_id, social_account_id, provider,
         status, published_at)
       values ($1, $2, $3, $4, 'instagram', 'live', now())`,
      [projectionId, transmissionId, workspaceId, accountId],
    );
    await postgres.query(
      `insert into account_metric_snapshots
        (social_account_id, workspace_id, provider, audience, total_views,
         raw_metrics, fetched_at)
       values
         ($1, $2, 'instagram', 1200, null, '{}', now() - interval '8 days'),
         ($1, $2, 'instagram', 1234, 123456,
          '{"totalInteractions":4321}', now())`,
      [accountId, workspaceId],
    );
    await postgres.query(
      `insert into daily_metric_snapshots
        (social_account_id, workspace_id, provider, metric_date, views, likes,
         comments, shares, audience_gained, audience_lost, fetched_at)
       values ($1, $2, 'instagram', current_date, 100, 10, 2, 1, 5, 1, now())`,
      [accountId, workspaceId],
    );
    await postgres.query(
      `insert into daily_metric_snapshots
        (social_account_id, workspace_id, provider, metric_date, views, likes,
         comments, shares, audience_gained, audience_lost, fetched_at)
       values ($1, $2, 'instagram', current_date - 7, 40, 4, 1, 0, 3, 1, now())`,
      [accountId, workspaceId],
    );
    await postgres.query(
      `insert into publication_metric_snapshots
        (projection_id, workspace_id, provider, views, likes, comments, shares,
         watch_time_seconds, average_view_duration_seconds, raw_metrics, fetched_at)
       values ($1, $2, 'instagram', 100, 10, 2, 1, 600, 8.2,
         '{"reach":75,"saves":4,"replays":12}'::jsonb, now())`,
      [projectionId, workspaceId],
    );

    const dashboard = await loadAnalyticsDashboard(postgres, workspaceId, 7);
    const instagram = dashboard.platforms.find(
      (platform) => platform.provider === "instagram",
    );
    assert.equal(instagram.connected, true);
    assert.equal(instagram.ready, true);
    assert.equal(instagram.audience, 1234);
    assert.equal(instagram.audienceDelta, 4);
    assert.equal(instagram.views, 100);
    assert.equal(instagram.reach, 75);
    assert.equal(instagram.saves, 4);
    assert.equal(instagram.watchMinutes, 10);
    assert.equal(instagram.averageWatchSeconds, 8.2);
    assert.equal(instagram.availableMetrics.includes("reach"), true);
    assert.equal(instagram.posts.length, 1);
    assert.equal(instagram.previousPeriod.audience, 1200);
    assert.equal(instagram.previousPeriod.views, 40);
    assert.equal(instagram.previousPeriod.audienceDelta, 2);

    const totalDashboard = await loadAnalyticsDashboard(
      postgres,
      workspaceId,
      "total",
    );
    const totalInstagram = totalDashboard.platforms.find(
      (platform) => platform.provider === "instagram",
    );
    assert.equal(totalDashboard.rangeDays, "total");
    assert.equal(totalInstagram.views, 123456);
    assert.equal(totalInstagram.totalInteractions, 4321);
    assert.equal(totalInstagram.daily.length, 2);
    assert.equal(totalInstagram.audienceDelta, 6);
    assert.equal(totalInstagram.previousPeriod, undefined);
    assert.deepEqual(
      dashboard.platforms.map((platform) => platform.provider),
      ["instagram", "tiktok", "facebook", "threads"],
    );
  } finally {
    await postgres.close();
  }
});
