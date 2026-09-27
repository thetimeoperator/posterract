/**
 * The grandfather snapshot (decision 19, Push 6.3).
 *
 * Lists everyone in the Discord server with the bot token (needs the Server
 * Members intent) and writes each of them into core.discord_grandfathered.
 * Everyone in that table is never removed and never has a role changed by the
 * bot. The script can only ADD rows (`on conflict do nothing`); the Hub's
 * database role cannot delete or change them at all (migration 021).
 *
 *   node --import tsx scripts/discord-snapshot.mjs
 *
 * Optional, only when Sina says so — put a visible label role on the people
 * in the snapshot (the table stays the source of truth, the role is cosmetic):
 *
 *   node --import tsx scripts/discord-snapshot.mjs --label-role=<roleId> [--only-with-role=<roleId>]
 *
 * --only-with-role limits the label to snapshot people who already have that
 * role (e.g. only verified members).
 */
import { postgres } from "../src/db.js";
import { createDiscordClient, discordConfig } from "../src/discord.js";

const argument = (name) =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1] ?? null;

const config = discordConfig();
if (!config.botToken || !config.guildId) {
  console.error("DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required");
  process.exit(1);
}

const client = createDiscordClient({ botToken: config.botToken });
const members = await client.members(config.guildId);
const bots = members.filter((member) => member.user.bot).length;

let added = 0;
for (const member of members) {
  const inserted = await postgres.query(
    `insert into core.discord_grandfathered (discord_user_id, username)
     values ($1, $2)
     on conflict (discord_user_id) do nothing`,
    [member.user.id, member.user.username ?? null],
  );
  added += inserted.rowCount;
}
const total = (await postgres.query(`select count(*)::int as n from core.discord_grandfathered`))
  .rows[0].n;

console.log(
  `server members listed: ${members.length} (${members.length - bots} people, ${bots} bots)`,
);
console.log(`newly added to the snapshot: ${added}`);
console.log(`snapshot rows now: ${total}`);

const labelRole = argument("label-role");
if (labelRole) {
  const onlyWith = argument("only-with-role");
  let labelled = 0;
  let already = 0;
  let skipped = 0;
  for (const member of members) {
    if (member.user.bot) continue;
    if (onlyWith && !(member.roles ?? []).includes(onlyWith)) {
      skipped += 1;
      continue;
    }
    if ((member.roles ?? []).includes(labelRole)) {
      already += 1;
      continue;
    }
    await client.addRole(
      config.guildId,
      member.user.id,
      labelRole,
      "Grandfathered at the AI FOR SAVAGES debut",
    );
    labelled += 1;
  }
  console.log(`label role: added to ${labelled}, already had it ${already}, left out ${skipped}`);
}

await postgres.end();
