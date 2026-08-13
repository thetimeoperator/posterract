import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { unzipSync } from "fflate";

const [, , archivePath] = process.argv;
if (!archivePath || !process.env.DATABASE_URL) {
  throw new Error(
    "Usage: DATABASE_URL=... node reconcile-convex-import.mjs <snapshot.zip>",
  );
}

const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
const decoder = new TextDecoder();
function sourceCount(name) {
  const entry = archive[`${name}/documents.jsonl`];
  if (!entry) return 0;
  const source = decoder.decode(entry).trim();
  return source ? source.split("\n").length : 0;
}

const checks = [
  ["users", "_components/betterAuth/user", `select count(*)::int as count from app_users where legacy_convex_id is not null`],
  ["authAccounts", "_components/betterAuth/account", `select count(*)::int as count from "account"`],
  ["workspaces", "workspaces", `select count(*)::int as count from workspaces where legacy_convex_id is not null`],
  ["portals", "portals", `select count(*)::int as count from social_accounts where legacy_convex_id is not null`],
  ["tokens", "portalTokens", `select count(*)::int as count from social_account_tokens`],
  ["transmissions", "transmissions", `select count(*)::int as count from transmissions where legacy_convex_id is not null`],
  ["projections", "projections", `select count(*)::int as count from projections where legacy_convex_id is not null`],
  ["events", "events", `select count(*)::int as count from events where legacy_convex_id is not null`],
  ["points", "pointsLedger", `select count(*)::int as count from points_ledger where legacy_convex_id is not null`],
  ["stats", "userStats", `select count(*)::int as count from user_stats where legacy_convex_id is not null`],
  ["publicationMetrics", "metricSnapshots", `select count(*)::int as count from publication_metric_snapshots where legacy_convex_id is not null`],
  ["accountMetrics", "accountMetricSnapshots", `select count(*)::int as count from account_metric_snapshots where legacy_convex_id is not null`],
  ["dailyMetrics", "dailyMetricSnapshots", `select count(*)::int as count from daily_metric_snapshots where legacy_convex_id is not null`],
  ["deletionRequests", "metaDeletionRequests", `select count(*)::int as count from meta_deletion_requests where legacy_convex_id is not null`],
  ["flows", "flows", `select count(*)::int as count from flows where legacy_convex_id is not null`],
];

const postgres = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const results = [];
  for (const [name, sourceTable, query] of checks) {
    const expected = sourceCount(sourceTable);
    const actual = (await postgres.query(query)).rows[0].count;
    results.push({ name, expected, actual, ok: expected === actual });
  }
  const sourceSessions = sourceCount("_components/betterAuth/session");
  const destinationSessions = (
    await postgres.query(`select count(*)::int as count from "session"`)
  ).rows[0].count;
  results.push({
    name: "invalidatedSessions",
    expected: 0,
    actual: destinationSessions,
    sourceSessions,
    ok: destinationSessions === 0,
  });
  const sourceArtifacts = sourceCount("artifacts");
  results.push({
    name: "unmigratedConvexStorageArtifacts",
    expected: 0,
    actual: sourceArtifacts,
    ok: sourceArtifacts === 0,
  });
  const credentialAccounts = (
    await postgres.query(
      `select count(*)::int as count from "account"
       where "providerId" = 'credential' and password is not null`,
    )
  ).rows[0].count;
  results.push({
    name: "credentialPasswordHashes",
    expected: sourceCount("_components/betterAuth/user"),
    actual: credentialAccounts,
    ok: credentialAccounts === sourceCount("_components/betterAuth/user"),
  });

  const ok = results.every((result) => result.ok);
  process.stdout.write(`${JSON.stringify({ ok, results }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
} finally {
  await postgres.end();
}
