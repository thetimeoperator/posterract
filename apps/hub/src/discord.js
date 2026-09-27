import { randomBytes } from "node:crypto";

import { postgres } from "./db.js";
import { queueReview } from "./provisioning.js";

/**
 * Discord — pay or leave (§9, Push 6).
 *
 * Two halves:
 *
 *   JOIN (always on once configured). A member presses Join Discord on the
 *   website → Discord's "Authorize" page (identify + guilds.join) → back to
 *   /v1/discord/callback → the Hub links that Discord account to the person
 *   and puts them in the server with the right role. The user's Discord token
 *   is used for that one join and thrown away.
 *
 *   ENFORCE (DISCORD_ENFORCEMENT = off | report | enforce). One engine,
 *   `reconcile`, decides who should not be in the server; `onAccessEnded`
 *   runs the same rule for one person the moment their access ends.
 *     off     does nothing and logs nothing
 *     report  writes every would-be action to core.discord_actions and makes
 *             NO Discord write call at all
 *     enforce acts
 *
 * The rules, in order, for every member of the server:
 *   1. in core.discord_grandfathered (decision 19) → untouched, not even logged
 *   2. the server owner, bots, DISCORD_PROTECTED_ROLES → untouched
 *   3. linked: still a member → make sure they have their role;
 *              lapsed → remove the role, then kick (never ban)
 *   4. not linked → kick once they have been seen for 3 days
 * Membership is re-checked immediately before every removal, and a run that
 * would remove more than 5 people, or more than 10% of the server, removes
 * nobody and asks a human (core.review_queue).
 */

const API = "https://discord.com/api/v10";
const PRODUCT_ID = "aiforsavages";
const DAY_MS = 24 * 60 * 60 * 1000;

export const STATE_TTL_MINUTES = 10;
export const UNLINKED_GRACE_DAYS = 3;
/** A run that would remove more than this many people removes nobody… */
export const MAX_REMOVALS = 5;
/** …and so does one that would remove more than this share of the server. */
export const MAX_REMOVAL_SHARE = 0.1;

export function discordConfig(env = process.env) {
  const mode = String(env.DISCORD_ENFORCEMENT ?? "off").trim().toLowerCase();
  return {
    clientId: env.DISCORD_CLIENT_ID ?? "",
    clientSecret: env.DISCORD_CLIENT_SECRET ?? "",
    botToken: env.DISCORD_BOT_TOKEN ?? "",
    guildId: env.DISCORD_GUILD_ID ?? "",
    roleFounding: env.DISCORD_ROLE_FOUNDING ?? "",
    roleMember: env.DISCORD_ROLE_MEMBER ?? "",
    protectedRoles: String(env.DISCORD_PROTECTED_ROLES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    // anything unrecognised is treated as off — the safe direction
    mode: ["report", "enforce"].includes(mode) ? mode : "off",
    redirectUri:
      env.DISCORD_REDIRECT_URI ?? "https://api.aiforsavages.fyi/v1/discord/callback",
    siteUrl: String(env.AFS_SITE_URL ?? "https://www.aiforsavages.fyi").replace(/\/+$/, ""),
  };
}

export function discordConfigured(config) {
  return Boolean(
    config.clientId &&
      config.clientSecret &&
      config.botToken &&
      config.guildId &&
      config.roleFounding &&
      config.roleMember,
  );
}

/** Where "Open Discord" goes for someone already in the server. */
export function serverUrl(config = discordConfig()) {
  return config.guildId ? `https://discord.com/channels/${config.guildId}` : null;
}

/* ------------------------------------------------------------------ */
/* Discord REST                                                        */
/* ------------------------------------------------------------------ */

/**
 * The only thing that talks to Discord. Tests pass their own object with the
 * same methods, so nothing in the test suite can reach the real server.
 */
export function createDiscordClient({
  botToken = process.env.DISCORD_BOT_TOKEN ?? "",
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  async function call(method, path, { auth = `Bot ${botToken}`, json, form, reason } = {}) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const headers = {
        Authorization: auth,
        "User-Agent": "DiscordBot (https://www.aiforsavages.fyi, 1.0)",
      };
      let body;
      if (json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json);
      } else if (form !== undefined) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(form).toString();
      }
      // shows up in the server's Audit Log next to the bot's action
      if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason);

      const response = await fetchImpl(`${API}${path}`, { method, headers, body });
      if (response.status === 429) {
        const limited = await response.json().catch(() => ({}));
        const seconds = Number(limited?.retry_after ?? response.headers?.get?.("retry-after") ?? 1);
        await sleep(Math.ceil(seconds * 1000) + 100);
        continue;
      }
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { status: response.status, data };
    }
    return { status: 429, data: null };
  }

  const expect = (result, statuses, what) => {
    if (!statuses.includes(result.status)) {
      const error = new Error(`discord_${what}_${result.status}`);
      error.status = result.status;
      throw error;
    }
    return result;
  };

  return {
    async guild(guildId) {
      return expect(await call("GET", `/guilds/${guildId}`), [200], "guild").data;
    },

    /** Every member (needs the Server Members intent). */
    async members(guildId) {
      const all = [];
      let after = "0";
      for (;;) {
        const page = expect(
          await call("GET", `/guilds/${guildId}/members?limit=1000&after=${after}`),
          [200],
          "members",
        ).data;
        all.push(...page);
        if (page.length < 1000) return all;
        after = page[page.length - 1].user.id;
      }
    },

    async member(guildId, userId) {
      const result = await call("GET", `/guilds/${guildId}/members/${userId}`);
      if (result.status === 404) return null;
      return expect(result, [200], "member").data;
    },

    /** 201 = added (with the roles), 204 = was already in (roles untouched). */
    async addMember(guildId, userId, accessToken, roles, reason) {
      const result = await call("PUT", `/guilds/${guildId}/members/${userId}`, {
        json: { access_token: accessToken, roles },
        reason,
      });
      return expect(result, [201, 204], "add_member").status;
    },

    async addRole(guildId, userId, roleId, reason) {
      expect(
        await call("PUT", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason }),
        [204],
        "role_add",
      );
    },

    /** 404 = no longer in the server, which is the goal anyway. */
    async removeRole(guildId, userId, roleId, reason) {
      expect(
        await call("DELETE", `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { reason }),
        [204, 404],
        "role_remove",
      );
    },

    /** A kick, never a ban: they can walk straight back in after renewing. */
    async kick(guildId, userId, reason) {
      expect(
        await call("DELETE", `/guilds/${guildId}/members/${userId}`, { reason }),
        [204, 404],
        "kick",
      );
    },

    async exchangeCode({ clientId, clientSecret, code, redirectUri }) {
      const result = await call("POST", "/oauth2/token", {
        auth: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        form: { grant_type: "authorization_code", code, redirect_uri: redirectUri },
      });
      expect(result, [200], "token");
      return typeof result.data?.access_token === "string" ? result.data.access_token : null;
    },

    async me(accessToken) {
      return expect(await call("GET", "/users/@me", { auth: `Bearer ${accessToken}` }), [200], "me")
        .data;
    },
  };
}

let sharedClient = null;
function defaultClient() {
  sharedClient ??= createDiscordClient();
  return sharedClient;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function hasMembership(accountId) {
  const result = await postgres.query(`select core.has_membership($1, $2) as ok`, [
    accountId,
    PRODUCT_ID,
  ]);
  return result.rows[0]?.ok === true;
}

/** Founding for founders, Member for everyone else who pays. */
async function roleKeyFor(accountId) {
  const result = await postgres.query(
    `select plan from core.memberships
      where account_id = $1 and product_id = $2 and status in ('active','past_due')
      order by created_at desc limit 1`,
    [accountId, PRODUCT_ID],
  );
  return result.rows[0]?.plan === "founding" ? "founding" : "member";
}

function roleIdFor(roleKey, config) {
  return roleKey === "founding" ? config.roleFounding : config.roleMember;
}

async function isGrandfathered(discordUserId) {
  const result = await postgres.query(
    `select 1 from core.discord_grandfathered where discord_user_id = $1`,
    [discordUserId],
  );
  return result.rowCount > 0;
}

async function record(step, mode, ok = null, error = null) {
  await postgres.query(
    `insert into core.discord_actions (discord_user_id, account_id, action, reason, mode, ok, error)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [step.id, step.accountId ?? null, step.action, step.reason, mode, ok, error],
  );
}

function untouchable(member, { ownerId, protectedRoles }) {
  return (
    member.user.id === ownerId ||
    member.user.bot === true ||
    (member.roles ?? []).some((roleId) => protectedRoles.has(roleId))
  );
}

/* ------------------------------------------------------------------ */
/* join: start → Discord → callback                                    */
/* ------------------------------------------------------------------ */

/** Issue a single-use state for this person and the Discord authorize URL. */
export async function startDiscordLink(accountId, { config = discordConfig() } = {}) {
  if (!discordConfigured(config)) return { ok: false, reason: "discord_not_configured" };

  const state = randomBytes(32).toString("hex");
  await postgres.query(
    `insert into core.discord_oauth_states (state, account_id, expires_at)
     values ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [state, accountId, String(STATE_TTL_MINUTES)],
  );
  // old states are useless; keep the table small
  await postgres.query(
    `delete from core.discord_oauth_states where expires_at < now() - interval '1 day'`,
  );

  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "identify guilds.join");
  url.searchParams.set("state", state);
  return { ok: true, url: url.toString() };
}

/** Burn a state: it works once, within 10 minutes, and names its person. */
async function burnState(state) {
  if (typeof state !== "string" || !/^[0-9a-f]{64}$/.test(state)) return null;
  const burned = await postgres.query(
    `update core.discord_oauth_states
        set used_at = now()
      where state = $1 and used_at is null and expires_at > now()
      returning account_id`,
    [state],
  );
  return burned.rows[0]?.account_id ?? null;
}

/**
 * The callback. Returns an `outcome` the website shows:
 * connected | linked_elsewhere | members_only | denied | error.
 */
export async function completeDiscordLink(
  { state, code, error } = {},
  { config = discordConfig(), client = defaultClient() } = {},
) {
  const accountId = await burnState(state);
  if (!accountId) return { outcome: "error", reason: "invalid_state" };
  if (error) return { outcome: "denied" };
  if (typeof code !== "string" || !code) return { outcome: "error", reason: "no_code" };
  if (!discordConfigured(config)) return { outcome: "error", reason: "discord_not_configured" };
  if (!(await hasMembership(accountId))) return { outcome: "members_only" };

  let accessToken = null;
  let user = null;
  try {
    accessToken = await client.exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: config.redirectUri,
    });
    if (!accessToken) return { outcome: "error", reason: "token_exchange_failed" };
    user = await client.me(accessToken);
  } catch {
    return { outcome: "error", reason: "discord_unavailable" };
  }
  if (!user?.id) return { outcome: "error", reason: "no_discord_user" };

  // one Discord account ↔ one person
  const taken = await postgres.query(
    `select 1 from core.discord_links where discord_user_id = $1 and account_id <> $2`,
    [user.id, accountId],
  );
  if (taken.rowCount > 0) return { outcome: "linked_elsewhere" };

  const reason = "Joined through aiforsavages.fyi";
  try {
    // switching Discord accounts: the old one loses its role and its link first
    const previous = await postgres.query(
      `select discord_user_id, role from core.discord_links where account_id = $1`,
      [accountId],
    );
    const old = previous.rows[0];
    if (old && old.discord_user_id !== user.id) {
      if (old.role && !(await isGrandfathered(old.discord_user_id))) {
        await client.removeRole(
          config.guildId,
          old.discord_user_id,
          roleIdFor(old.role, config),
          "Switched to another Discord account on aiforsavages.fyi",
        );
      }
      await postgres.query(`delete from core.discord_links where account_id = $1`, [accountId]);
    }

    const roleKey = await roleKeyFor(accountId);
    const roleId = roleIdFor(roleKey, config);
    let role = roleKey;

    const status = await client.addMember(config.guildId, user.id, accessToken, [roleId], reason);
    if (status === 204) {
      // already in the server. Decision 19: a grandfathered person keeps
      // exactly the roles they have — they are linked, nothing else changes.
      if (await isGrandfathered(user.id)) role = null;
      else await client.addRole(config.guildId, user.id, roleId, reason);
    }

    await postgres.query(
      `insert into core.discord_links
         (account_id, discord_user_id, discord_username, guild_id, linked_at, in_guild, role, last_synced_at)
       values ($1, $2, $3, $4, now(), true, $5, now())
       on conflict (account_id) do update
         set discord_user_id = excluded.discord_user_id,
             discord_username = excluded.discord_username,
             guild_id = excluded.guild_id,
             in_guild = true,
             role = excluded.role,
             last_synced_at = now()`,
      [accountId, user.id, user.global_name ?? user.username ?? null, config.guildId, role],
    );
    // the 3-day clock for unlinked people no longer applies to them
    await postgres.query(`delete from core.discord_first_seen where discord_user_id = $1`, [
      user.id,
    ]);
    return { outcome: "connected" };
  } catch (failure) {
    if (failure?.code === "23505") return { outcome: "linked_elsewhere" };
    return { outcome: "error", reason: String(failure?.message ?? "join_failed") };
  } finally {
    // the user's Discord token is never stored
    accessToken = null;
  }
}

/** Disconnect: remove the role, drop the link. Never kicks. */
export async function unlinkDiscord(
  accountId,
  { config = discordConfig(), client = defaultClient() } = {},
) {
  const found = await postgres.query(
    `select discord_user_id, role, in_guild from core.discord_links where account_id = $1`,
    [accountId],
  );
  const link = found.rows[0];
  if (!link) return { ok: true, wasLinked: false };

  if (link.role && link.in_guild && discordConfigured(config)) {
    if (!(await isGrandfathered(link.discord_user_id))) {
      try {
        await client.removeRole(
          config.guildId,
          link.discord_user_id,
          roleIdFor(link.role, config),
          "Disconnected Discord on aiforsavages.fyi",
        );
      } catch {
        return { ok: false, reason: "discord_unavailable" };
      }
    }
  }
  await postgres.query(`delete from core.discord_links where account_id = $1`, [accountId]);
  return { ok: true, wasLinked: true };
}

/* ------------------------------------------------------------------ */
/* enforcement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Carry out a plan. In report mode every step is written down and nothing is
 * sent to Discord. A removal is re-checked against the membership (and the
 * snapshot, and the link) right before it happens, so a renewal a moment ago
 * always wins over a plan made earlier.
 */
async function applyPlan(plan, mode, config, client) {
  const done = [];
  for (const step of plan) {
    const removal = step.action === "kick" || step.action === "role_remove";
    if (removal) {
      if (await isGrandfathered(step.id)) continue;
      if (step.accountId && (await hasMembership(step.accountId))) {
        await record({ ...step, action: "skip", reason: `renewed before ${step.action}` }, mode, true);
        continue;
      }
      if (!step.accountId) {
        const linkedNow = await postgres.query(
          `select 1 from core.discord_links where discord_user_id = $1`,
          [step.id],
        );
        if (linkedNow.rowCount > 0) continue;
      }
    }

    if (mode !== "enforce") {
      await record(step, "report", null);
      done.push({ ...step, performed: false });
      continue;
    }

    const auditReason =
      step.reason === "membership_ended"
        ? "AI FOR SAVAGES membership ended"
        : step.reason === "not_linked"
          ? "Not joined through aiforsavages.fyi"
          : "AI FOR SAVAGES membership";
    try {
      if (step.action === "role_add") {
        await client.addRole(config.guildId, step.id, step.roleId, auditReason);
      } else if (step.action === "role_remove") {
        await client.removeRole(config.guildId, step.id, step.roleId, auditReason);
      } else if (step.action === "kick") {
        await client.kick(config.guildId, step.id, auditReason);
        if (step.accountId) {
          await postgres.query(
            `update core.discord_links set in_guild = false, last_synced_at = now()
              where account_id = $1`,
            [step.accountId],
          );
        }
      }
      await record(step, "enforce", true);
      done.push({ ...step, performed: true });
    } catch (failure) {
      await record(step, "enforce", false, String(failure?.message ?? failure));
      done.push({ ...step, performed: false, error: String(failure?.message ?? failure) });
    }
  }
  return done;
}

function summarise(plan) {
  const counts = { role_add: 0, role_remove: 0, kick: 0 };
  for (const step of plan) counts[step.action] = (counts[step.action] ?? 0) + 1;
  return counts;
}

/**
 * The whole-server sweep (the nightly job, and on demand from
 * scripts/discord-reconcile.mjs).
 */
export async function reconcile({
  config = discordConfig(),
  mode = config.mode,
  client = defaultClient(),
  now = new Date(),
} = {}) {
  if (mode !== "report" && mode !== "enforce") return { mode: "off", ran: false };
  if (!discordConfigured(config)) return { mode, ran: false, reason: "discord_not_configured" };

  const [guild, members] = await Promise.all([
    client.guild(config.guildId),
    client.members(config.guildId),
  ]);
  const grandfathered = new Set(
    (await postgres.query(`select discord_user_id from core.discord_grandfathered`)).rows.map(
      (row) => row.discord_user_id,
    ),
  );
  const links = new Map(
    (
      await postgres.query(
        `select account_id, discord_user_id, role from core.discord_links where guild_id = $1`,
        [config.guildId],
      )
    ).rows.map((row) => [row.discord_user_id, row]),
  );
  const guard = { ownerId: guild.owner_id, protectedRoles: new Set(config.protectedRoles) };
  const ourRoles = [config.roleFounding, config.roleMember];

  const plan = [];
  let skippedGrandfathered = 0;
  let skippedUntouchable = 0;
  let inGrace = 0;

  for (const member of members) {
    const id = member.user.id;
    if (grandfathered.has(id)) {
      skippedGrandfathered += 1;
      continue;
    }
    if (untouchable(member, guard)) {
      skippedUntouchable += 1;
      continue;
    }

    const link = links.get(id);
    if (link) {
      if (await hasMembership(link.account_id)) {
        const roleId = roleIdFor(await roleKeyFor(link.account_id), config);
        if (!(member.roles ?? []).includes(roleId)) {
          plan.push({ action: "role_add", id, accountId: link.account_id, roleId, reason: "member_missing_role" });
        }
      } else {
        for (const roleId of ourRoles.filter((roleId) => (member.roles ?? []).includes(roleId))) {
          plan.push({ action: "role_remove", id, accountId: link.account_id, roleId, reason: "membership_ended" });
        }
        plan.push({ action: "kick", id, accountId: link.account_id, reason: "membership_ended" });
      }
      continue;
    }

    // in the server without a link, and not grandfathered: start (or read)
    // their 3-day clock
    const seen = await postgres.query(
      `insert into core.discord_first_seen (discord_user_id) values ($1)
       on conflict (discord_user_id) do update set discord_user_id = excluded.discord_user_id
       returning first_seen_at`,
      [id],
    );
    const firstSeen = new Date(seen.rows[0].first_seen_at).getTime();
    if (now.getTime() - firstSeen >= UNLINKED_GRACE_DAYS * DAY_MS) {
      plan.push({ action: "kick", id, accountId: null, reason: "not_linked" });
    } else {
      inGrace += 1;
    }
  }

  // keep each link honest about whether that person is still in the server
  const present = new Set(members.map((member) => member.user.id));
  for (const [id, link] of links) {
    await postgres.query(
      `update core.discord_links set in_guild = $2, last_synced_at = now() where account_id = $1`,
      [link.account_id, present.has(id)],
    );
  }

  const removals = plan.filter((step) => step.action === "kick").length;
  const capped = removals > MAX_REMOVALS || removals > members.length * MAX_REMOVAL_SHARE;
  const base = {
    mode,
    ran: true,
    members: members.length,
    skippedGrandfathered,
    skippedUntouchable,
    unlinkedInGrace: inGrace,
    planned: summarise(plan),
  };

  if (capped) {
    // do nothing, write it all down, and ask a human
    for (const step of plan) {
      await record({ ...step, action: "skip", reason: `capped: would ${step.action} (${step.reason})` }, mode, null);
    }
    await queueReview(postgres, "discord_removal_cap", null, {
      guildId: config.guildId,
      mode,
      wouldRemove: removals,
      members: members.length,
      at: now.toISOString(),
    });
    return { ...base, capped: true, performed: 0 };
  }

  const done = await applyPlan(plan, mode, config, client);
  return {
    ...base,
    capped: false,
    performed: done.filter((step) => step.performed).length,
    failed: done.filter((step) => step.error).length,
  };
}

/**
 * One person's access just ended (subscription deleted, refund, dispute).
 * Same rules as the sweep, for one person, straight away.
 */
export async function onAccessEnded(
  accountId,
  { config = discordConfig(), mode = config.mode, client = defaultClient() } = {},
) {
  if (mode !== "report" && mode !== "enforce") return { ran: false, reason: "off" };
  if (!discordConfigured(config)) return { ran: false, reason: "discord_not_configured" };

  const found = await postgres.query(
    `select discord_user_id from core.discord_links where account_id = $1 and guild_id = $2`,
    [accountId, config.guildId],
  );
  const id = found.rows[0]?.discord_user_id;
  if (!id) return { ran: false, reason: "not_linked" };
  if (await isGrandfathered(id)) return { ran: false, reason: "grandfathered" };
  if (await hasMembership(accountId)) return { ran: false, reason: "still_a_member" };

  const [guild, member] = await Promise.all([
    client.guild(config.guildId),
    client.member(config.guildId, id),
  ]);
  if (!member) {
    await postgres.query(
      `update core.discord_links set in_guild = false, last_synced_at = now() where account_id = $1`,
      [accountId],
    );
    return { ran: true, reason: "not_in_server" };
  }
  if (untouchable(member, { ownerId: guild.owner_id, protectedRoles: new Set(config.protectedRoles) })) {
    return { ran: false, reason: "protected" };
  }

  const plan = [config.roleFounding, config.roleMember]
    .filter((roleId) => (member.roles ?? []).includes(roleId))
    .map((roleId) => ({ action: "role_remove", id, accountId, roleId, reason: "membership_ended" }));
  plan.push({ action: "kick", id, accountId, reason: "membership_ended" });
  const done = await applyPlan(plan, mode, config, client);
  return { ran: true, mode, steps: done.length };
}

/**
 * The nightly sweep, started by the server process. Runs at 04:00 UTC; in
 * off mode it does nothing at all.
 */
export function scheduleNightlyReconcile({ log = console, hourUtc = 4 } = {}) {
  const run = async () => {
    const config = discordConfig();
    if (config.mode === "off") return;
    try {
      const result = await reconcile({ config });
      log.info?.({ discord: result }, "discord reconcile");
    } catch (failure) {
      log.error?.({ err: failure }, "discord reconcile failed");
    }
  };
  const next = new Date();
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
  const first = setTimeout(() => {
    void run();
    setInterval(() => void run(), DAY_MS).unref?.();
  }, next.getTime() - Date.now());
  first.unref?.();
}
