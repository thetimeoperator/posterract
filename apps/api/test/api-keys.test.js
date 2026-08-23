import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadWorkspaceApiKeys } from "../src/apiKeys.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, "../../../deploy/posterract/postgres/init");

test("API key summaries report publishing activity without counting joined projections twice", async () => {
  const postgres = new PGlite({ extensions: { pgcrypto } });
  const ids = {
    user: "00000000-0000-4000-8000-000000000101",
    workspace: "00000000-0000-4000-8000-000000000102",
    key: "00000000-0000-4000-8000-000000000103",
    media: "00000000-0000-4000-8000-000000000104",
    live: "00000000-0000-4000-8000-000000000105",
    scheduled: "00000000-0000-4000-8000-000000000106",
    liveProjection: "00000000-0000-4000-8000-000000000107",
    failedProjection: "00000000-0000-4000-8000-000000000108",
    scheduledProjection: "00000000-0000-4000-8000-000000000109",
  };

  try {
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "003-agent-harness.sql", "004-agent-chats.sql", "005-tiktok-draft-status.sql"]) {
      await postgres.exec(await readFile(resolve(migrations, name), "utf8"));
    }
    await postgres.query("insert into app_users (id, email) values ($1, 'keys@example.test')", [ids.user]);
    await postgres.query("insert into workspaces (id, owner_id, name) values ($1, $2, 'Keys')", [ids.workspace, ids.user]);
    await postgres.query(
      `insert into api_keys (id, workspace_id, name, key_prefix, secret_hash, scopes)
       values ($1, $2, 'Publishing agent', 'pr_live_test', 'hash-test', '{posts:write}')`,
      [ids.key, ids.workspace],
    );
    await postgres.query(
      `insert into media_assets
        (id, workspace_id, original_filename, r2_key, mime_type, size_bytes, status)
       values ($1, $2, 'post.mp4', 'tests/post.mp4', 'video/mp4', 100, 'attached')`,
      [ids.media, ids.workspace],
    );
    await postgres.query(
      `insert into transmissions
        (id, workspace_id, media_asset_id, title, status, schedule_mode, scheduled_for, source)
       values
        ($1, $3, $4, 'Published', 'live', 'now', now(), 'api'),
        ($2, $3, $4, 'Scheduled', 'scheduled', 'at', now() + interval '1 day', 'api')`,
      [ids.live, ids.scheduled, ids.workspace, ids.media],
    );
    await postgres.query(
      `insert into projections (id, transmission_id, workspace_id, provider, status)
       values
        ($1, $4, $6, 'instagram', 'live'),
        ($2, $4, $6, 'facebook', 'failed'),
        ($3, $5, $6, 'threads', 'scheduled')`,
      [ids.liveProjection, ids.failedProjection, ids.scheduledProjection, ids.live, ids.scheduled, ids.workspace],
    );
    await postgres.query(
      `insert into api_audit_logs
        (workspace_id, api_key_id, action, resource_type, resource_id)
       values
        ($1, $2, 'post.create', 'transmission', $3),
        ($1, $2, 'post.create', 'transmission', $4),
        ($1, $2, 'projection.retry', 'projection', $5)`,
      [ids.workspace, ids.key, ids.live, ids.scheduled, ids.failedProjection],
    );

    const keys = await loadWorkspaceApiKeys(postgres, ids.workspace);
    assert.equal(keys.length, 1);
    assert.deepEqual(keys[0].stats, {
      apiActions: 3,
      postsCreated: 2,
      postsScheduled: 1,
      postsPublished: 1,
    });
  } finally {
    await postgres.close();
  }
});
