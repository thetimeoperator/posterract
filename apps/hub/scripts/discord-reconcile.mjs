/**
 * Run one Discord reconcile now, in the mode the Hub is configured for
 * (DISCORD_ENFORCEMENT), and print what it did — or, in report mode, what it
 * would have done. The nightly job runs exactly the same function.
 *
 *   node --import tsx scripts/discord-reconcile.mjs
 */
import { postgres } from "../src/db.js";
import { discordConfig, reconcile } from "../src/discord.js";

const config = discordConfig();
const started = new Date();
const result = await reconcile({ config });
console.log(JSON.stringify(result, null, 2));

if (result.ran) {
  const rows = await postgres.query(
    `select action, reason, count(*)::int as n
       from core.discord_actions
      where at >= $1 and mode = $2
      group by action, reason
      order by n desc`,
    [started, config.mode],
  );
  console.log(`actions written this run (${config.mode}):`);
  for (const row of rows.rows) console.log(`  ${row.action.padEnd(12)} ${row.reason.padEnd(40)} ${row.n}`);
  if (rows.rowCount === 0) console.log("  none");
}

await postgres.end();
