import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import Fastify from "fastify";
import {
  pkceChallenge,
  registerDesktopAuthRoutes,
  validateDesktopStartInput,
} from "../src/desktopAuth.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = resolve(here, "../../../deploy/posterract/postgres/init");

test("desktop authorization validates native device and PKCE input", () => {
  const verifier = "a".repeat(43);
  const input = validateDesktopStartInput({
    deviceName: "Sina's MacBook",
    platform: "darwin",
    appVersion: "0.1.0",
    codeChallenge: pkceChallenge(verifier),
  });
  assert.deepEqual(input, {
    deviceName: "Sina's MacBook",
    platform: "darwin",
    appVersion: "0.1.0",
    codeChallenge: pkceChallenge(verifier),
  });
});

test("desktop authorization rejects unsupported platforms and weak PKCE", () => {
  assert.equal(
    validateDesktopStartInput({
      deviceName: "Browser",
      platform: "web",
      codeChallenge: "too-short",
    }),
    undefined,
  );
});

test("desktop authorization approves, exchanges, rotates, and rejects refresh reuse", async () => {
  const database = new PGlite({ extensions: { pgcrypto } });
  const query = async (sql, values = []) => {
    const result = await database.query(sql, values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  const postgres = {
    query,
    connect: async () => ({ query, release() {} }),
  };
  const app = Fastify({ logger: false });
  const userId = "00000000-0000-4000-8000-000000000091";
  const workspaceId = "00000000-0000-4000-8000-000000000092";
  const browserSession = async (request) => {
    request.authContext = { kind: "session", userId, workspaceId, role: "owner" };
  };
  registerDesktopAuthRoutes(app, {
    postgres,
    requireBrowserSession: browserSession,
    requireInteractiveSession: browserSession,
    environment: { SITE_URL: "https://www.posterract.app" },
  });

  try {
    for (const name of ["001-posterract.sql", "002-postgres-cutover.sql", "009-desktop-auth.sql"]) {
      await database.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
    }
    await query(
      `insert into app_users (id, email) values ($1, 'desktop@example.test')`,
      [userId],
    );
    await query(
      `insert into workspaces (id, owner_id, name) values ($1, $2, 'Desktop test')`,
      [workspaceId, userId],
    );
    await query(
      `insert into workspace_memberships (workspace_id, user_id, role)
       values ($1, $2, 'owner') on conflict do nothing`,
      [workspaceId, userId],
    );

    const verifier = "desktop-pkce-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
    const start = await app.inject({
      method: "POST",
      url: "/v1/desktop/auth/start",
      payload: {
        deviceName: "Desktop test",
        platform: "darwin",
        appVersion: "0.1.0",
        codeChallenge: pkceChallenge(verifier),
      },
    });
    assert.equal(start.statusCode, 200);
    const grant = start.json();
    assert.match(grant.pollToken, /^pd_poll_/);
    assert.match(grant.verificationUrl, /\/desktop\/authorize\?request=/);

    const approval = await app.inject({
      method: "POST",
      url: "/v1/desktop/auth/approve",
      payload: { requestId: grant.requestId },
    });
    assert.equal(approval.statusCode, 200);

    const exchange = await app.inject({
      method: "POST",
      url: "/v1/desktop/auth/exchange",
      payload: { requestId: grant.requestId, pollToken: grant.pollToken, codeVerifier: verifier },
    });
    assert.equal(exchange.statusCode, 200);
    const firstPair = exchange.json();
    assert.match(firstPair.accessToken, /^pd_access_/);
    assert.match(firstPair.refreshToken, /^pd_refresh_/);

    const refresh = await app.inject({
      method: "POST",
      url: "/v1/desktop/auth/refresh",
      payload: { refreshToken: firstPair.refreshToken },
    });
    assert.equal(refresh.statusCode, 200);
    assert.notEqual(refresh.json().refreshToken, firstPair.refreshToken);

    const reuse = await app.inject({
      method: "POST",
      url: "/v1/desktop/auth/refresh",
      payload: { refreshToken: firstPair.refreshToken },
    });
    assert.equal(reuse.statusCode, 401);
    assert.equal(reuse.json().error, "refresh_token_reuse");
    const device = await query("select revoked_at from desktop_devices limit 1");
    assert.equal(Boolean(device.rows[0].revoked_at), true);
  } finally {
    await app.close();
    await database.close();
  }
});
