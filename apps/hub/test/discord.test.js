import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgres } from "../src/db.js";
import {
  MAX_REMOVALS,
  completeDiscordLink,
  onAccessEnded,
  reconcile,
  startDiscordLink,
  unlinkDiscord,
} from "../src/discord.js";

/**
 * Push 6 — Discord, pay or leave.
 *
 * Every test talks to a fake Discord built below, never the real server: the
 * fake records each call, so "report mode makes zero write calls" and "the
 * snapshot is never touched" are counted, not assumed. Everything is scoped to
 * a guild id of its own, so the real server's links and snapshot are never read
 * or written by a test.
 */

const RUN = randomUUID().slice(0, 8);
const GUILD = `guild-${RUN}`;
const ROLE_FOUNDING = `role-founding-${RUN}`;
const ROLE_MEMBER = `role-member-${RUN}`;
const ROLE_PROTECTED = `role-mod-${RUN}`;
const OWNER = `dsc-${RUN}-owner`;

const config = {
  clientId: "client",
  clientSecret: "secret",
  botToken: "bot",
  guildId: GUILD,
  roleFounding: ROLE_FOUNDING,
  roleMember: ROLE_MEMBER,
  protectedRoles: [ROLE_PROTECTED],
  mode: "off",
  redirectUri: "https://api.example.test/v1/discord/callback",
  siteUrl: "https://site.example.test",
};

let seq = 0;
const discordId = (label) => `dsc-${RUN}-${label}-${(seq += 1)}`;
const made = [];

function fakeDiscord() {
  const members = new Map();
  const calls = [];
  const codes = new Map();
  const snapshot = (member) => ({ user: { ...member.user }, roles: [...member.roles] });
  const client = {
    async guild() {
      return { id: GUILD, owner_id: OWNER };
    },
    async members() {
      return [...members.values()].map(snapshot);
    },
    async member(_guild, id) {
      const member = members.get(id);
      return member ? snapshot(member) : null;
    },
    async addMember(_guild, id, _token, roles) {
      calls.push({ write: "addMember", id, roles });
      if (members.has(id)) return 204;
      members.set(id, { user: { id, username: id }, roles: [...roles] });
      return 201;
    },
    async addRole(_guild, id, role) {
      calls.push({ write: "addRole", id, role });
      const member = members.get(id);
      if (member && !member.roles.includes(role)) member.roles.push(role);
    },
    async removeRole(_guild, id, role) {
      calls.push({ write: "removeRole", id, role });
      const member = members.get(id);
      if (member) member.roles = member.roles.filter((value) => value !== role);
    },
    async kick(_guild, id) {
      calls.push({ write: "kick", id });
      members.delete(id);
    },
    async exchangeCode({ code }) {
      return codes.has(code) ? `token-${code}` : null;
    },
    async me(token) {
      return codes.get(token.replace(/^token-/, "")) ?? null;
    },
  };
  return {
    client,
    members,
    calls,
    writes: () => calls.filter((call) => call.write),
    writesFor: (id) => calls.filter((call) => call.write && call.id === id),
    put(id, { roles = [], bot = false } = {}) {
      members.set(id, { user: { id, username: id, bot }, roles: [...roles] });
    },
    /** this Discord user will come back from the authorize page */
    willAuthorize(id) {
      const code = `code-${id}`;
      codes.set(code, { id, username: id, global_name: `Name ${id}` });
      return code;
    },
  };
}

async function person({ plan = "monthly", active = true } = {}) {
  const created = await postgres.query(
    `insert into app_users (id, email, display_name, email_verified)
     values (gen_random_uuid(), $1, 'Discord Test', true) returning id`,
    [`dtest-${RUN}-${randomUUID().slice(0, 6)}@example.com`],
  );
  const accountId = created.rows[0].id;
  made.push(accountId);
  await postgres.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, member_since, ended_at)
     values ($1, 'aiforsavages', $2, $3, 'manual', now() - interval '2 months',
             case when $3 = 'active' then null else now() - interval '1 day' end)`,
    [accountId, plan, active ? "active" : "canceled"],
  );
  return accountId;
}

async function lapse(accountId) {
  await postgres.query(
    `update core.memberships set status = 'canceled', ended_at = now() where account_id = $1`,
    [accountId],
  );
}

async function renew(accountId) {
  await postgres.query(
    `insert into core.memberships (account_id, product_id, plan, status, source, member_since)
     values ($1, 'aiforsavages', 'monthly', 'active', 'manual', now())`,
    [accountId],
  );
}

async function link(accountId, id, role = "member") {
  await postgres.query(
    `insert into core.discord_links (account_id, discord_user_id, discord_username, guild_id, in_guild, role)
     values ($1, $2, $2, $3, true, $4)`,
    [accountId, id, GUILD, role],
  );
}

async function grandfather(id) {
  await postgres.query(
    `insert into core.discord_grandfathered (discord_user_id, username) values ($1, $1)`,
    [id],
  );
}

/** Grandfathered bystanders, so a small test server is not tripped by the 10% stop. */
async function fill(discord, count) {
  for (let index = 0; index < count; index += 1) {
    const filler = discordId("bystander");
    await grandfather(filler);
    discord.put(filler);
  }
}

async function seenDaysAgo(id, days) {
  await postgres.query(
    `insert into core.discord_first_seen (discord_user_id, first_seen_at)
     values ($1, now() - ($2 || ' days')::interval)`,
    [id, String(days)],
  );
}

async function actionsFor(id) {
  return (
    await postgres.query(
      `select action, reason, mode, ok from core.discord_actions where discord_user_id = $1 order by at`,
      [id],
    )
  ).rows;
}

async function linkOf(accountId) {
  return (
    await postgres.query(
      `select discord_user_id, in_guild, role, guild_id from core.discord_links where account_id = $1`,
      [accountId],
    )
  ).rows[0];
}

/** Start the flow and pull the state out of the authorize URL. */
async function stateFor(accountId) {
  const started = await startDiscordLink(accountId, { config });
  assert.equal(started.ok, true);
  return new URL(started.url).searchParams.get("state");
}

after(async () => {
  const pattern = `dsc-${RUN}-%`;
  await postgres.query(`delete from core.discord_actions where discord_user_id like $1`, [pattern]);
  await postgres.query(`delete from core.discord_first_seen where discord_user_id like $1`, [pattern]);
  // test rows only (their ids carry this run's marker); the real snapshot is never touched
  await postgres.query(`delete from core.discord_grandfathered where discord_user_id like $1`, [pattern]);
  await postgres.query(`delete from core.review_queue where kind = 'discord_removal_cap' and details->>'guildId' = $1`, [GUILD]);
  if (made.length) {
    await postgres.query(`delete from core.discord_links where account_id = any($1::uuid[])`, [made]);
    await postgres.query(`delete from core.discord_oauth_states where account_id = any($1::uuid[])`, [made]);
    await postgres.query(`delete from core.memberships where account_id = any($1::uuid[])`, [made]);
    await postgres.query(`delete from app_users where id = any($1::uuid[])`, [made]);
  }
  await postgres.end();
});

/* ------------------------------------------------------------------ */
/* join                                                                */
/* ------------------------------------------------------------------ */

test("a Join Discord state works once, only for ten minutes, and asks for identify + guilds.join", async () => {
  const discord = fakeDiscord();
  const member = await person();
  const id = discordId("joiner");
  const code = discord.willAuthorize(id);

  const started = await startDiscordLink(member, { config });
  const url = new URL(started.url);
  assert.equal(url.searchParams.get("scope"), "identify guilds.join");
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  const state = url.searchParams.get("state");
  assert.match(state, /^[0-9a-f]{64}$/);

  const first = await completeDiscordLink({ state, code }, { config, client: discord.client });
  assert.equal(first.outcome, "connected");
  assert.deepEqual(discord.members.get(id).roles, [ROLE_MEMBER], "in the server with the Member role");
  const linked = await linkOf(member);
  assert.equal(linked.discord_user_id, id);
  assert.equal(linked.in_guild, true);
  assert.equal(linked.guild_id, GUILD);

  const replay = await completeDiscordLink({ state, code }, { config, client: discord.client });
  assert.deepEqual(replay, { outcome: "error", reason: "invalid_state" }, "a state works once");

  const expired = "e".repeat(64);
  await postgres.query(
    `insert into core.discord_oauth_states (state, account_id, expires_at) values ($1, $2, now() - interval '1 minute')`,
    [expired, member],
  );
  const late = await completeDiscordLink({ state: expired, code }, { config, client: discord.client });
  assert.deepEqual(late, { outcome: "error", reason: "invalid_state" }, "and only for 10 minutes");
});

test("founders get Founding; someone already in gets the role added; a grandfathered person is left exactly as they are", async () => {
  const discord = fakeDiscord();

  const founder = await person({ plan: "founding" });
  const founderId = discordId("founder");
  const founderCode = discord.willAuthorize(founderId);
  assert.equal(
    (await completeDiscordLink({ state: await stateFor(founder), code: founderCode }, { config, client: discord.client })).outcome,
    "connected",
  );
  assert.deepEqual(discord.members.get(founderId).roles, [ROLE_FOUNDING]);

  const alreadyIn = await person();
  const alreadyInId = discordId("already-in");
  discord.put(alreadyInId, { roles: ["some-other-role"] });
  const alreadyInCode = discord.willAuthorize(alreadyInId);
  await completeDiscordLink({ state: await stateFor(alreadyIn), code: alreadyInCode }, { config, client: discord.client });
  assert.ok(discord.members.get(alreadyInId).roles.includes(ROLE_MEMBER), "204 → the role is added");

  const og = await person();
  const ogId = discordId("og");
  await grandfather(ogId);
  discord.put(ogId, { roles: ["their-own-role"] });
  const ogCode = discord.willAuthorize(ogId);
  const before = discord.writes().length;
  const result = await completeDiscordLink({ state: await stateFor(og), code: ogCode }, { config, client: discord.client });
  assert.equal(result.outcome, "connected", "they are linked…");
  assert.deepEqual(discord.members.get(ogId).roles, ["their-own-role"], "…and their roles are untouched");
  assert.deepEqual(
    discord.calls.slice(before).filter((call) => call.write && call.write !== "addMember"),
    [],
    "no role write for a grandfathered person",
  );
  assert.equal((await linkOf(og)).role, null);
});

test("one Discord account belongs to one person, and switching removes the old one's role first", async () => {
  const discord = fakeDiscord();
  const alice = await person();
  const bob = await person();
  const shared = discordId("shared");
  const code = discord.willAuthorize(shared);

  assert.equal((await completeDiscordLink({ state: await stateFor(alice), code }, { config, client: discord.client })).outcome, "connected");
  const stolen = await completeDiscordLink({ state: await stateFor(bob), code }, { config, client: discord.client });
  assert.equal(stolen.outcome, "linked_elsewhere");
  assert.equal(await linkOf(bob), undefined, "bob got nothing");

  const second = discordId("second");
  const secondCode = discord.willAuthorize(second);
  const before = discord.calls.length;
  assert.equal((await completeDiscordLink({ state: await stateFor(alice), code: secondCode }, { config, client: discord.client })).outcome, "connected");
  const after_ = discord.calls.slice(before).filter((call) => call.write);
  assert.deepEqual(after_[0], { write: "removeRole", id: shared, role: ROLE_MEMBER }, "the old account loses its role first");
  assert.equal(after_[1].write, "addMember");
  assert.equal((await linkOf(alice)).discord_user_id, second);
  assert.equal(after_.some((call) => call.write === "kick"), false, "switching never kicks");
});

test("a non-member coming back from Discord is refused and nothing is written to Discord", async () => {
  const discord = fakeDiscord();
  const lapsed = await person();
  const state = await stateFor(lapsed);
  await lapse(lapsed);
  const result = await completeDiscordLink(
    { state, code: discord.willAuthorize(discordId("late")) },
    { config, client: discord.client },
  );
  assert.equal(result.outcome, "members_only");
  assert.equal(discord.writes().length, 0);
});

/* ------------------------------------------------------------------ */
/* enforcement                                                         */
/* ------------------------------------------------------------------ */

test("off does nothing and writes nothing", async () => {
  const discord = fakeDiscord();
  const lapsed = await person({ active: false });
  const id = discordId("off");
  discord.put(id, { roles: [ROLE_MEMBER] });
  await link(lapsed, id);

  assert.deepEqual(await reconcile({ config, mode: "off", client: discord.client }), { mode: "off", ran: false });
  assert.equal((await onAccessEnded(lapsed, { config, mode: "off", client: discord.client })).ran, false);
  assert.equal(discord.writes().length, 0);
  assert.deepEqual(await actionsFor(id), []);
});

test("report mode writes down every would-be action and sends Discord nothing", async () => {
  const discord = fakeDiscord();
  const lapsed = await person({ active: false });
  const lapsedId = discordId("report-lapsed");
  discord.put(lapsedId, { roles: [ROLE_MEMBER] });
  await link(lapsed, lapsedId);

  const stranger = discordId("report-stranger");
  discord.put(stranger);
  await seenDaysAgo(stranger, 4);

  const roleless = await person();
  const rolelessId = discordId("report-roleless");
  discord.put(rolelessId);
  await link(roleless, rolelessId);
  await fill(discord, 20);

  const result = await reconcile({ config, mode: "report", client: discord.client });
  assert.equal(result.capped, false);
  assert.deepEqual(result.planned, { role_add: 1, role_remove: 1, kick: 2 });
  assert.equal(discord.writes().length, 0, "zero Discord write calls in report mode");

  assert.deepEqual(
    (await actionsFor(lapsedId)).map((row) => [row.action, row.mode]),
    [["role_remove", "report"], ["kick", "report"]],
  );
  assert.deepEqual((await actionsFor(stranger)).map((row) => [row.action, row.reason]), [["kick", "not_linked"]]);
  assert.deepEqual((await actionsFor(rolelessId)).map((row) => row.action), ["role_add"]);
  assert.equal(discord.members.size, 23, "nobody left the server");
});

test("enforce: a lapsed member loses the role, is kicked (never banned), and walks back in through the button after renewing", async () => {
  const discord = fakeDiscord();
  const member = await person();
  const id = discordId("lapser");
  discord.put(id, { roles: [ROLE_MEMBER] });
  await link(member, id);
  await fill(discord, 10);

  await lapse(member);
  const result = await reconcile({ config, mode: "enforce", client: discord.client });
  assert.equal(result.performed, 2);
  const writes = discord.writesFor(id).map((call) => call.write);
  assert.deepEqual(writes, ["removeRole", "kick"], "role first, then the kick");
  assert.equal(discord.members.has(id), false);
  assert.equal(discord.calls.some((call) => /ban/i.test(call.write ?? "")), false, "never a ban");
  assert.equal((await linkOf(member)).in_guild, false);
  assert.deepEqual(
    (await actionsFor(id)).map((row) => [row.action, row.mode, row.ok]),
    [["role_remove", "enforce", true], ["kick", "enforce", true]],
  );

  await renew(member);
  const back = await completeDiscordLink(
    { state: await stateFor(member), code: discord.willAuthorize(id) },
    { config, client: discord.client },
  );
  assert.equal(back.outcome, "connected");
  assert.deepEqual(discord.members.get(id).roles, [ROLE_MEMBER], "back in, with the role");
  assert.equal((await linkOf(member)).in_guild, true);
});

test("a renewal a moment before the removal wins", async () => {
  const discord = fakeDiscord();
  const member = await person();
  const id = discordId("renewer");
  discord.put(id, { roles: [ROLE_MEMBER] });
  await link(member, id);
  await lapse(member);

  // the plan is made (access ended), then they renew before anything is sent
  const client = {
    ...discord.client,
    async member(guild, userId) {
      const found = await discord.client.member(guild, userId);
      await renew(member);
      return found;
    },
  };
  const result = await onAccessEnded(member, { config, mode: "enforce", client });
  assert.equal(result.ran, true);
  assert.deepEqual(discord.writesFor(id), [], "nothing removed");
  assert.equal(discord.members.has(id), true);
  assert.deepEqual(
    (await actionsFor(id)).map((row) => [row.action, row.reason]),
    [["skip", "renewed before role_remove"], ["skip", "renewed before kick"]],
  );
});

test("the snapshot is untouchable: a grandfathered person is never touched, even when lapsed", async () => {
  const discord = fakeDiscord();
  const og = await person({ active: false });
  const ogId = discordId("og-lapsed");
  await grandfather(ogId);
  discord.put(ogId, { roles: [ROLE_MEMBER, "their-role"] });
  await link(og, ogId);

  const ogUnlinked = discordId("og-unlinked");
  await grandfather(ogUnlinked);
  discord.put(ogUnlinked);
  await seenDaysAgo(ogUnlinked, 30);

  const result = await reconcile({ config, mode: "enforce", client: discord.client });
  assert.equal(result.skippedGrandfathered, 2);
  assert.deepEqual(discord.writes(), []);
  assert.deepEqual(await actionsFor(ogId), [], "not even logged");
  assert.deepEqual(await actionsFor(ogUnlinked), []);

  const ended = await onAccessEnded(og, { config, mode: "enforce", client: discord.client });
  assert.deepEqual(ended, { ran: false, reason: "grandfathered" });
  assert.deepEqual(discord.writes(), []);
});

test("the server owner, bots and protected roles are never touched", async () => {
  const discord = fakeDiscord();
  const bot = discordId("bot");
  const mod = discordId("mod");
  discord.put(OWNER);
  discord.put(bot, { bot: true });
  discord.put(mod, { roles: [ROLE_PROTECTED] });
  for (const id of [OWNER, bot, mod]) await seenDaysAgo(id, 30);

  const result = await reconcile({ config, mode: "enforce", client: discord.client });
  assert.equal(result.skippedUntouchable, 3);
  assert.deepEqual(discord.writes(), []);
  for (const id of [OWNER, bot, mod]) assert.deepEqual(await actionsFor(id), []);
});

test("someone in the server without a link is kicked only after three days", async () => {
  const discord = fakeDiscord();
  const fresh = discordId("fresh");
  const old = discordId("old");
  discord.put(fresh);
  discord.put(old);
  for (let index = 0; index < 20; index += 1) {
    const filler = discordId("filler");
    await grandfather(filler);
    discord.put(filler);
  }
  await seenDaysAgo(old, 3);

  const result = await reconcile({ config, mode: "enforce", client: discord.client });
  assert.equal(result.unlinkedInGrace, 1, "the one seen today waits");
  assert.deepEqual(discord.writes(), [{ write: "kick", id: old }]);
  assert.equal(discord.members.has(fresh), true);
});

test(`the safety stop: more than ${MAX_REMOVALS} removals, or more than 10% of the server, removes nobody`, async () => {
  // 6 removals in a server of 70 (under 10%) — the absolute cap fires
  const big = fakeDiscord();
  const six = [];
  for (let index = 0; index < 6; index += 1) {
    const id = discordId("six");
    six.push(id);
    big.put(id);
    await seenDaysAgo(id, 10);
  }
  for (let index = 0; index < 64; index += 1) {
    const filler = discordId("filler70");
    await grandfather(filler);
    big.put(filler);
  }
  const capped = await reconcile({ config, mode: "enforce", client: big.client });
  assert.equal(capped.members, 70);
  assert.equal(capped.capped, true);
  assert.deepEqual(big.writes(), [], "nobody removed");
  assert.equal(big.members.size, 70);
  for (const id of six) {
    assert.deepEqual((await actionsFor(id)).map((row) => row.action), ["skip"]);
  }
  const review = await postgres.query(
    `select details from core.review_queue where kind = 'discord_removal_cap' and details->>'guildId' = $1`,
    [GUILD],
  );
  assert.equal(review.rowCount, 1, "a human is asked");
  assert.equal(review.rows[0].details.wouldRemove, 6);

  // 3 removals in a server of 20 — only 3, but 15%: the share cap fires
  const small = fakeDiscord();
  for (let index = 0; index < 3; index += 1) {
    const id = discordId("three");
    small.put(id);
    await seenDaysAgo(id, 10);
  }
  for (let index = 0; index < 17; index += 1) {
    const filler = discordId("filler20");
    await grandfather(filler);
    small.put(filler);
  }
  const share = await reconcile({ config, mode: "enforce", client: small.client });
  assert.equal(share.capped, true);
  assert.deepEqual(small.writes(), []);

  // exactly 5 in a server of 60 goes ahead
  const edge = fakeDiscord();
  for (let index = 0; index < 5; index += 1) {
    const id = discordId("five");
    edge.put(id);
    await seenDaysAgo(id, 10);
  }
  for (let index = 0; index < 55; index += 1) {
    const filler = discordId("filler60");
    await grandfather(filler);
    edge.put(filler);
  }
  const allowed = await reconcile({ config, mode: "enforce", client: edge.client });
  assert.equal(allowed.capped, false);
  assert.equal(edge.writes().filter((call) => call.write === "kick").length, 5);
});

test("unlinking removes the role and never kicks", async () => {
  const discord = fakeDiscord();
  const member = await person();
  const id = discordId("unlinker");
  discord.put(id, { roles: [ROLE_MEMBER] });
  await link(member, id);

  const result = await unlinkDiscord(member, { config, client: discord.client });
  assert.deepEqual(result, { ok: true, wasLinked: true });
  assert.deepEqual(discord.writesFor(id), [{ write: "removeRole", id, role: ROLE_MEMBER }]);
  assert.equal(discord.members.has(id), true, "still in the server");
  assert.equal(await linkOf(member), undefined, "the link is gone");
});
