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

test("PostgreSQL application migrations apply cleanly and idempotently", async () => {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const migrations = await Promise.all(
    ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql"].map(async (name) => ({
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
    ]) {
      assert.equal(names.has(required), true, `${required} table is missing`);
    }

    const accountIndexes = await postgres.query(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'social_accounts'`,
    );
    assert.equal(
      accountIndexes.rows.some(
        (row) => row.indexname === "social_accounts_one_provider_per_workspace_idx",
      ),
      true,
    );
  } finally {
    await postgres.close();
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
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql"]) {
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
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql"]) {
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
        (social_account_id, workspace_id, provider, audience, fetched_at)
       values ($1, $2, 'instagram', 1234, now())`,
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
      `insert into publication_metric_snapshots
        (projection_id, workspace_id, provider, views, likes, comments, shares,
         fetched_at)
       values ($1, $2, 'instagram', 100, 10, 2, 1, now())`,
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
    assert.equal(instagram.posts.length, 1);
  } finally {
    await postgres.close();
  }
});
