import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { loadVaultMedia, registerMediaDeleteRoute } from "../src/media.js";

test("Vault listing and deletion tolerate missing media without bypassing ownership or active-post checks", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(await readFile(new URL("../../../deploy/posterract/postgres/init/001-posterract.sql", import.meta.url), "utf8"));
  const owner = randomUUID(), other = randomUUID();
  await db.query("insert into workspaces (id, name) values ($1, 'Owner'), ($2, 'Other')", [owner, other]);
  const calls = [];
  let storageError, authorized = true;
  const postgres = { query: (sql, params) => db.query(sql, params), connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
  const app = Fastify();
  t.after(() => app.close());
  registerMediaDeleteRoute(app, {
    postgres, environment: { R2_BUCKET: "test-bucket" }, requiredWorkspace: () => owner,
    requireMediaWrite: async (_request, reply) => { if (!authorized) return reply.code(403).send({ error: "forbidden" }); },
    r2: { send: async (command) => { calls.push(command); if (storageError) throw storageError; } },
  });
  const add = async ({ status = "ready", purged = false, workspace = owner } = {}) => {
    const id = randomUUID();
    await db.query(
      `insert into media_assets (id, workspace_id, original_filename, r2_key, mime_type, size_bytes, status, purged_at)
       values ($1, $2, 'clip.mp4', $3, 'video/mp4', 100, $4, $5)`,
      [id, workspace, `test/${id}.mp4`, status, purged ? new Date() : null],
    );
    return id;
  };
  const remove = (id) => app.inject({ method: "DELETE", url: `/v1/media/${id}` });
  const row = async (id) => (await db.query("select * from media_assets where id = $1", [id])).rows[0];

  await t.test("the library excludes aborted uploads and any asset already marked as purged", async () => {
    const ready = await add();
    const gone = await Promise.all([
      add({ status: "aborted", purged: true }), add({ status: "aborted" }),
      add({ status: "purged" }), add({ status: "attached", purged: true }), add({ workspace: other }),
    ]);
    const visible = (await loadVaultMedia(postgres, owner)).rows.map((media) => media.id);
    assert.ok(visible.includes(ready));
    for (const id of gone) assert.ok(!visible.includes(id));
    for (const id of [gone[0], gone[2], gone[3], randomUUID()]) assert.equal((await remove(id)).statusCode, 204);
    assert.equal(calls.length, 0);
  });

  await t.test("missing storage objects still delete the entry, including repeated requests", async () => {
    for (const name of ["NoSuchKey", "NotFound"]) {
      const id = await add();
      storageError = Object.assign(new Error("Missing object"), { name, $metadata: { httpStatusCode: 404 } });
      const before = calls.length;
      assert.equal((await remove(id)).statusCode, 204);
      assert.equal((await row(id)).status, "purged");
      assert.ok((await row(id)).purged_at);
      assert.ok(!(await loadVaultMedia(postgres, owner)).rows.some((media) => media.id === id));
      assert.equal((await remove(id)).statusCode, 204);
      assert.equal(calls.length, before + 1);
    }
    storageError = undefined;
  });

  await t.test("normal deletion removes the intended object and library entry", async () => {
    const id = await add();
    assert.equal((await remove(id)).statusCode, 204);
    assert.equal(calls.at(-1).constructor.name, "DeleteObjectCommand");
    assert.deepEqual(calls.at(-1).input, { Bucket: "test-bucket", Key: `test/${id}.mp4` });
    assert.equal((await row(id)).status, "purged");
  });

  await t.test("scheduled and transmitting media remain protected", async () => {
    for (const status of ["scheduled", "transmitting"]) {
      const id = await add();
      await db.query("insert into transmissions (workspace_id, media_asset_id, title, status, schedule_mode, source) values ($1, $2, 'Active', $3, 'now', 'ui')", [owner, id, status]);
      const before = calls.length;
      const response = await remove(id);
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "media_in_use");
      assert.equal(calls.length, before);
      assert.equal((await row(id)).purged_at, null);
    }
  });

  await t.test("other workspaces and unauthorized requests cannot delete media", async () => {
    const foreign = await add({ workspace: other });
    const local = await add();
    const before = calls.length;
    assert.equal((await remove(foreign)).statusCode, 204);
    assert.equal((await row(foreign)).status, "ready");
    authorized = false;
    assert.equal((await remove(local)).statusCode, 403);
    authorized = true;
    assert.equal((await row(local)).status, "ready");
    assert.equal(calls.length, before);
  });

  await t.test("storage permission, bucket and outage errors do not hide undeleted files", async () => {
    for (const name of ["AccessDenied", "NoSuchBucket", "ServiceUnavailable"]) {
      const id = await add();
      storageError = Object.assign(new Error(name), { name });
      assert.equal((await remove(id)).statusCode, 500);
      assert.equal((await row(id)).status, "ready");
      assert.equal((await row(id)).purged_at, null);
    }
    storageError = undefined;
  });
});
