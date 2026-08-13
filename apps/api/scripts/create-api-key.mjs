import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";

const [
  ,
  ,
  workspaceOrEmail,
  name = "Agent API key",
  scopesInput = "accounts:read,media:write,posts:write,posts:read,analytics:read",
] = process.argv;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
if (!workspaceOrEmail) {
  throw new Error(
    "Usage: node apps/api/scripts/create-api-key.mjs <workspace-id-or-owner-email> [name] [comma-separated-scopes]",
  );
}

const scopes = scopesInput
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);
if (scopes.length === 0) {
  throw new Error("At least one scope is required");
}
const allowedScopes = new Set([
  "accounts:read",
  "accounts:write",
  "media:write",
  "posts:write",
  "posts:read",
  "analytics:read",
]);
const invalidScopes = scopes.filter((scope) => !allowedScopes.has(scope));
if (invalidScopes.length > 0) {
  throw new Error(`Unsupported scopes: ${invalidScopes.join(", ")}`);
}

const prefix = randomBytes(4).toString("hex");
const token = `pr_live_${prefix}_${randomBytes(32).toString("base64url")}`;
const secretHash = createHash("sha256").update(token).digest("hex");
const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const workspace = workspaceOrEmail.includes("@")
    ? await postgres.query(
        `select w.id
         from workspaces w
         join app_users u on u.id = w.owner_id
         where lower(u.email) = lower($1)
         order by w.created_at asc
         limit 1`,
        [workspaceOrEmail],
      )
    : await postgres.query("select id from workspaces where id = $1", [
        workspaceOrEmail,
      ]);
  if (workspace.rowCount === 0) {
    throw new Error(`Workspace owner ${workspaceOrEmail} does not exist`);
  }
  const workspaceId = workspace.rows[0].id;

  await postgres.query(
    `insert into api_keys
      (workspace_id, name, key_prefix, secret_hash, scopes)
     values ($1, $2, $3, $4, $5)`,
    [workspaceId, name, prefix, secretHash, scopes],
  );

  process.stdout.write(
    `${JSON.stringify({
      token,
      prefix,
      workspaceId,
      scopes,
      warning: "Copy this token now. Posterract stores only its SHA-256 hash.",
    })}\n`,
  );
} finally {
  await postgres.end();
}
