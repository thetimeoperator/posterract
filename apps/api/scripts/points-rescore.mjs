/**
 * Scores every workspace from scratch under the points rules
 * (apps/api/src/points.js), for when the rules change and everyone should be
 * paid again under the new ones. Nothing from before launch day counts.
 *
 *   node --import tsx scripts/points-rescore.mjs                dry run
 *   node --import tsx scripts/points-rescore.mjs --apply        rescore for real
 *   ... --workspace <id>                                        one workspace only
 *
 * Each workspace is cleared and scored again inside a transaction. The dry
 * run rolls that transaction back, so its report is exactly what --apply
 * would write, and nothing changes. Posts' points are dated when each post
 * went live, and the relaunch sends no notifications (it clears the old
 * points ones too).
 */
import { Pool } from "pg";
import { levelFor, rankFor } from "@posterract/contract";
import { scoreWorkspace } from "../src/points.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.includes("--workspace") ? args[args.indexOf("--workspace") + 1] : undefined;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const workspaces = await pool.query(
    `select id, name from workspaces ${only ? "where id = $1" : ""} order by created_at`,
    only ? [only] : [],
  );
  const rows = [];
  for (const workspace of workspaces.rows) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from points_ledger where workspace_id = $1", [workspace.id]);
      await client.query("delete from post_points where workspace_id = $1", [workspace.id]);
      await client.query("delete from follower_baselines where workspace_id = $1", [workspace.id]);
      await client.query("delete from events where workspace_id = $1 and type like 'points.%'", [workspace.id]);
      const report = await scoreWorkspace(client, workspace.id, { backfill: true, notify: false });
      await client.query(apply ? "commit" : "rollback");
      rows.push({
        workspace: workspace.name,
        points: report.paid,
        level: levelFor(report.paid),
        rank: rankFor(report.paid).label,
        ...report.bySource,
      });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  rows.sort((left, right) => right.points - left.points);
  console.table(rows);
  console.log(
    apply
      ? `Rescored ${rows.length} workspaces.`
      : `Dry run: nothing was written. Pass --apply to rescore ${rows.length} workspaces.`,
  );
} finally {
  await pool.end();
}
