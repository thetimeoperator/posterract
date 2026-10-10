import Fastify from "fastify";

import { postgres, normalizeEmail } from "./db.js";
import {
  requireService,
  clerkUserIdFrom,
  verifiedPrimaryEmail,
} from "./auth.js";
import {
  dashboardFor,
  wallFeed,
  createPost,
  toggleFire,
  reportPost,
  hideOwnPost,
  rankings,
  communityTotals,
  currentChallenge,
  githubStatus,
  githubTokenFor,
  connectGithub,
  disconnectGithub,
  fetchContributionCalendar,
  applyContributionCalendar,
  recomputeRanks,
} from "./community.js";
import {
  resolveAccount,
  buildMe,
  accountIdForClerkUser,
} from "./accounts.js";
import { queueReview } from "./provisioning.js";
import {
  discordConfig,
  startDiscordLink,
  completeDiscordLink,
  unlinkDiscord,
  onAccessEnded,
  scheduleNightlyReconcile,
} from "./discord.js";
import {
  stripe,
  PRICES,
  createCheckout,
  createPortal,
  cancelMembership,
  resumeMembership,
  handleStripeEvent,
  grantFromLegacySession,
  createGuestCheckout,
  guestCheckoutStatus,
  posterractUrl,
  publicPlans,
} from "./billing.js";

export function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // never log tokens or full emails at info level
      redact: [
        "req.headers.authorization",
        "req.headers['x-clerk-token']",
        "req.headers['svix-signature']",
      ],
      serializers: {
        // the Discord callback carries a one-time code and state in its query
        // string; keep them out of the logs
        req(request) {
          const url = String(request.url ?? "");
          return {
            method: request.method,
            url: url.startsWith("/v1/discord/callback") ? "/v1/discord/callback" : url,
            host: request.headers?.host,
            remoteAddress: request.ip,
            remotePort: request.socket?.remotePort,
          };
        },
      },
    },
    bodyLimit: 1_000_000,
  });

  // keep the raw body so webhook signatures can be verified against bytes
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      request.rawBody = body;
      try {
        done(null, body.length ? JSON.parse(body) : {});
      } catch (error) {
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );

  /* ------------------------------------------------------------------ */
  /* health — must answer even if Stripe / Clerk / Discord are down      */
  /* ------------------------------------------------------------------ */

  app.get("/health", async (_request, reply) => {
    let database = "down";
    try {
      await postgres.query("select 1");
      database = "up";
    } catch {
      database = "down";
    }
    // 200 either way so a deploy never looks dead, but `ok` tells the truth —
    // a monitor that only reads the status code must also read the body.
    return reply.code(200).send({ ok: database === "up", database });
  });

  /* ------------------------------------------------------------------ */
  /* accounts                                                            */
  /* ------------------------------------------------------------------ */

  /** Called after every Clerk sign-in. Idempotent. */
  app.post("/v1/accounts/resolve", async (request, reply) => {
    if (!requireService(request, reply)) return;
    const clerkUserId = await clerkUserIdFrom(request, reply);
    if (!clerkUserId) return;

    const identity = await verifiedPrimaryEmail(clerkUserId);
    if (!identity.verified) {
      // no link on an unverified email — this is the §3 hijack guard
      return reply.code(409).send({
        error: "email_not_verified",
        reason: identity.reason ?? "email_not_verified",
      });
    }

    const result = await resolveAccount({
      clerkUserId,
      email: normalizeEmail(identity.email),
      verified: true,
      displayName: identity.displayName,
      imageUrl: identity.imageUrl,
    });

    if (!result.ok) {
      const code = result.reason === "collision" ? 409 : 400;
      return reply.code(code).send({ error: result.reason });
    }

    const me = await buildMe(result.accountId);
    return reply.send({ ...me, action: result.action });
  });

  /** The only thing the website uses to decide what is unlocked. */
  app.get("/v1/me", async (request, reply) => {
    if (!requireService(request, reply)) return;
    const clerkUserId = await clerkUserIdFrom(request, reply);
    if (!clerkUserId) return;

    const accountId = await accountIdForClerkUser(clerkUserId);
    if (!accountId) return reply.code(404).send({ error: "not_resolved" });

    const me = await buildMe(accountId);
    if (!me) return reply.code(404).send({ error: "not_found" });
    return reply.send(me);
  });

  /* ------------------------------------------------------------------ */
  /* profile                                                             */
  /* ------------------------------------------------------------------ */

  const HANDLE = /^[a-z0-9_]{3,20}$/;

  app.patch("/v1/me/profile", async (request, reply) => {
    if (!requireService(request, reply)) return;
    const clerkUserId = await clerkUserIdFrom(request, reply);
    if (!clerkUserId) return;

    const accountId = await accountIdForClerkUser(clerkUserId);
    if (!accountId) return reply.code(404).send({ error: "not_resolved" });

    const body = request.body ?? {};
    const updates = {};

    if (body.handle !== undefined) {
      const handle = String(body.handle).trim().toLowerCase();
      if (!HANDLE.test(handle)) {
        return reply.code(400).send({ error: "invalid_handle" });
      }
      updates.handle = handle;
    }

    if (body.showOnWall !== undefined) {
      updates.show_on_wall = Boolean(body.showOnWall);
    }

    if (body.mainProjectName !== undefined) {
      const name = body.mainProjectName
        ? String(body.mainProjectName).trim().slice(0, 40)
        : null;
      updates.main_project_name = name || null;
    }

    if (body.mainProjectUrl !== undefined) {
      const url = body.mainProjectUrl ? String(body.mainProjectUrl).trim() : null;
      // re-validated server-side: http/https only, never trust the client
      if (url && !/^https?:\/\//i.test(url)) {
        return reply.code(400).send({ error: "invalid_project_url" });
      }
      if (url && url.length > 200) {
        return reply.code(400).send({ error: "project_url_too_long" });
      }
      updates.main_project_url = url;
    }

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: "nothing_to_update" });
    }

    const columns = Object.keys(updates);
    const values = columns.map((column) => updates[column]);
    const assignments = columns
      .map((column, index) => `${column} = $${index + 2}`)
      .join(", ");
    const inserts = columns.join(", ");
    const placeholders = columns.map((_, index) => `$${index + 2}`).join(", ");

    try {
      await postgres.query(
        `insert into afs.profiles (account_id, ${inserts})
         values ($1, ${placeholders})
         on conflict (account_id) do update
           set ${assignments}, updated_at = now()`,
        [accountId, ...values],
      );
    } catch (error) {
      if (error.code === "23505") {
        return reply.code(409).send({ error: "handle_taken" });
      }
      throw error;
    }

    return reply.send(await buildMe(accountId));
  });

  /* ------------------------------------------------------------------ */
  /* billing                                                             */
  /* ------------------------------------------------------------------ */

  /** Requires the service key AND the person's own Clerk token. */
  async function personFrom(request, reply) {
    if (!requireService(request, reply)) return null;
    const clerkUserId = await clerkUserIdFrom(request, reply);
    if (!clerkUserId) return null;
    const accountId = await accountIdForClerkUser(clerkUserId);
    if (!accountId) {
      reply.code(404).send({ error: "not_resolved" });
      return null;
    }
    return accountId;
  }

  app.post("/v1/billing/checkout", async (request, reply) => {
    const accountId = await personFrom(request, reply);
    if (!accountId) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });

    // the plan name is all the client may choose — the price is server config
    const plan = String(request.body?.plan ?? "");
    if (!PRICES[plan]) return reply.code(400).send({ error: "unknown_plan" });

    const result = await createCheckout({
      accountId,
      plan,
      successUrl: request.body?.successUrl ?? `${process.env.AFS_SITE_URL}/?success=true`,
      cancelUrl: request.body?.cancelUrl ?? `${process.env.AFS_SITE_URL}/?canceled=true`,
    });
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return reply.send({ url: result.url });
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const accountId = await personFrom(request, reply);
    if (!accountId) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    const result = await createPortal({
      accountId,
      returnUrl: request.body?.returnUrl ?? `${process.env.AFS_SITE_URL}/profile`,
    });
    return reply.send(result);
  });

  app.post("/v1/billing/cancel", async (request, reply) => {
    const accountId = await personFrom(request, reply);
    if (!accountId) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    const result = await cancelMembership(accountId);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return reply.send(await buildMe(accountId));
  });

  app.post("/v1/billing/resume", async (request, reply) => {
    const accountId = await personFrom(request, reply);
    if (!accountId) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    const result = await resumeMembership(accountId);
    if (!result.ok) return reply.code(409).send({ error: result.reason });
    return reply.send(await buildMe(accountId));
  });

  /** Stripe posts here. Signature is verified against the raw bytes. */
  app.post("/v1/webhooks/stripe", async (request, reply) => {
    const secret = process.env.AFS_STRIPE_WEBHOOK_SECRET;
    if (!secret || !stripe) {
      return reply.code(503).send({ error: "not_configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody ?? "",
        request.headers["stripe-signature"],
        secret,
      );
    } catch {
      return reply.code(400).send({ error: "invalid_signature" });
    }

    try {
      const result = await handleStripeEvent(event);
      const { accountId, ...shown } = result ?? {};
      if (accountId && (shown.kind === "canceled" || shown.kind === "refunded")) {
        // access just ended: the Discord rule runs now (it does nothing in off
        // mode). Not awaited — Stripe gets its answer either way.
        onAccessEnded(accountId).catch((failure) =>
          request.log.error({ err: failure }, "discord onAccessEnded failed"),
        );
      }
      return reply.send({ received: true, ...shown });
    } catch (error) {
      request.log.error({ err: error, type: event.type }, "stripe event failed");
      // 500 makes Stripe retry, which is what we want on a transient failure
      return reply.code(500).send({ error: "handler_failed" });
    }
  });

  /**
   * TEMPORARY bridge for the old one-time checkout, which is still created and
   * still received by the website rather than here (§8 keeps it on sale until
   * the new flow has taken a real payment).
   *
   * Service key only, and no Clerk token: the caller is our own webhook, which
   * has already verified Stripe's signature. Note that the body carries only a
   * session id — the Hub reads the payment, the price and the person back from
   * Stripe and Clerk itself, so nothing here is taken on trust.
   */
  app.post("/v1/service/legacy-purchase", async (request, reply) => {
    if (!requireService(request, reply)) return;

    const sessionId = request.body?.sessionId;
    try {
      const result = await grantFromLegacySession(sessionId, verifiedPrimaryEmail);
      if (!result.ok) {
        // 200 for "correctly declined" so the website's webhook does not make
        // Stripe retry a payment that will never qualify; 4xx would loop.
        const permanent = [
          "not_our_price",
          "not_paid",
          "invalid_session_id",
          "session_not_found",
          "no_clerk_user_in_session",
          "email_not_verified",
          "collision",
        ];
        const code = permanent.includes(result.reason) ? 200 : 503;
        return reply.code(code).send({ granted: false, ...result });
      }
      return reply.send({ granted: true, ...result });
    } catch (error) {
      request.log.error({ err: error }, "legacy purchase bridge failed");
      return reply.code(500).send({ error: "handler_failed" });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Posterract: service key only. Its API calls these over the VPS's    */
  /* internal network to sell AI FOR SAVAGES on posterract.app.          */
  /* ------------------------------------------------------------------ */

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** The three plans' live prices, for Posterract's landing card. */
  app.get("/v1/service/posterract/plans", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    return reply.send({ plans: await publicPlans() });
  });

  /**
   * Stripe Checkout for one plan. With `accountId` (a signed-in Posterract
   * user, vouched for by the Posterract API) the membership lands on that
   * person; without it, the email the buyer types on Stripe's page decides
   * who they are (fulfillGuestCheckout).
   */
  app.post("/v1/service/posterract/checkout", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    const plan = String(request.body?.plan ?? "");
    if (!PRICES[plan]) return reply.code(400).send({ error: "unknown_plan" });
    const accountId = request.body?.accountId;
    if (accountId !== undefined && !UUID.test(String(accountId))) {
      return reply.code(400).send({ error: "invalid_account" });
    }
    try {
      const result = accountId
        ? await createCheckout({
            accountId,
            plan,
            successUrl: posterractUrl("/portals?savages=joined"),
            cancelUrl: posterractUrl("/portals"),
          })
        : await createGuestCheckout({ plan });
      if (!result.ok) {
        return reply.code(result.reason === "already_a_member" ? 409 : 400).send({ error: result.reason });
      }
      return reply.send({ url: result.url });
    } catch (error) {
      request.log.error({ err: error }, "posterract checkout failed");
      return reply.code(502).send({ error: "stripe_request_failed" });
    }
  });

  /** For Posterract's welcome page: records a paid guest checkout if the webhook has not, and says where it stands. */
  app.post("/v1/service/posterract/checkout-status", async (request, reply) => {
    if (!requireService(request, reply)) return;
    if (!stripe) return reply.code(503).send({ error: "stripe_not_configured" });
    try {
      return reply.send(await guestCheckoutStatus(request.body?.sessionId));
    } catch (error) {
      request.log.error({ err: error }, "guest checkout status failed");
      return reply.code(500).send({ error: "handler_failed" });
    }
  });

  /* ------------------------------------------------------------------ */
  /* community (Phase H)                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Every community route runs this first.
   *
   * The Wall and Rankings are member-only (§7), and membership is established
   * here from core.has_membership — never from anything the browser sends. A
   * signed-in non-member gets 403, which is a real answer, not an error.
   *
   * Returns null when it has already replied.
   */
  async function communityCaller(request, reply, { membersOnly = true } = {}) {
    if (!requireService(request, reply)) return null;

    const clerkUserId = await clerkUserIdFrom(request, reply);
    if (!clerkUserId) return null;

    const accountId = await accountIdForClerkUser(clerkUserId);
    if (!accountId) {
      reply.code(404).send({ error: "not_resolved" });
      return null;
    }

    const member = await postgres.query(
      `select core.has_membership($1, 'aiforsavages') as ok`,
      [accountId],
    );
    const isMember = member.rows[0]?.ok === true;

    if (membersOnly && !isMember) {
      reply.code(403).send({ error: "not_a_member" });
      return null;
    }
    return { clerkUserId, accountId, isMember };
  }

  /** The signed-in member's own numbers: points, level, streak, heatmap. */
  app.get("/v1/community/dashboard", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;
    return reply.send(await dashboardFor(caller.accountId));
  });

  /** The Wall feed. */
  app.get("/v1/community/wall", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const feed = await wallFeed({
      viewerAccountId: caller.accountId,
      viewerIsMember: caller.isMember,
      filter: request.query?.filter,
      sort: request.query?.sort,
      limit: request.query?.limit,
      cursor: request.query?.cursor,
    });
    return reply.send({ ...feed, challenge: await currentChallenge() });
  });

  /** Post to the Wall. */
  app.post("/v1/community/wall", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const result = await createPost(caller.accountId, request.body ?? {});
    if (!result.ok) return reply.code(400).send({ error: result.reason });
    return reply.code(201).send(result);
  });

  /** Toggle 🔥. */
  app.post("/v1/community/wall/:id/fire", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const result = await toggleFire(caller.accountId, request.params.id);
    if (!result.ok) {
      return reply.code(result.reason === "post_not_found" ? 404 : 400)
        .send({ error: result.reason });
    }
    return reply.send(result);
  });

  app.post("/v1/community/wall/:id/report", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const result = await reportPost(
      caller.accountId,
      request.params.id,
      request.body?.reason,
    );
    if (!result.ok) return reply.code(404).send({ error: result.reason });
    return reply.send({ ok: true });
  });

  /** An author taking their own post down. */
  app.delete("/v1/community/wall/:id", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const result = await hideOwnPost(caller.accountId, request.params.id);
    if (!result.ok) return reply.code(403).send({ error: result.reason });
    return reply.send({ ok: true });
  });

  /** The leaderboard. */
  app.get("/v1/community/rankings", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    return reply.send(
      await rankings({
        range: request.query?.range === "all" ? "all" : "month",
        viewerAccountId: caller.accountId,
        limit: request.query?.limit,
        withHeatmaps: request.query?.heatmaps !== "0",
      }),
    );
  });

  /** Community totals, readable by any signed-in person for the landing copy. */
  app.get("/v1/community/totals", async (request, reply) => {
    const caller = await communityCaller(request, reply, { membersOnly: false });
    if (!caller) return;
    return reply.send(await communityTotals());
  });

  app.get("/v1/community/github", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;
    return reply.send(await githubStatus(caller.accountId));
  });

  /**
   * Pull the member's contribution calendar and pay for it.
   *
   * Idempotent, so the browser calling it on every visit is harmless — the
   * second run of a day awards nothing.
   */
  app.post("/v1/community/github/sync", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const token = await githubTokenFor(caller.accountId);
    if (!token.ok) {
      if (token.reason === "github_not_configured") {
        return reply.code(503).send({ error: token.reason });
      }
      // 409, not 500: nothing is broken, they simply have not connected GitHub
      return reply.code(409).send({ error: token.reason });
    }

    let calendar;
    try {
      calendar = await fetchContributionCalendar(token.token);
    } catch (error) {
      request.log.warn({ err: error }, "github calendar fetch failed");
      return reply.code(502).send({ error: "github_unavailable" });
    }

    const applied = await applyContributionCalendar(caller.accountId, calendar);
    if (!applied.ok) return reply.code(409).send({ error: applied.reason });

    // ranks move when anyone's points move
    await recomputeRanks();
    return reply.send(applied);
  });

  /**
   * Connect GitHub. The site ran the OAuth exchange with its own client id and
   * secret and passes the resulting token here, once. The Hub proves it
   * against GitHub, applies the one-account-per-person rule, stores it
   * sealed, and runs the first sync — all or nothing.
   *
   * The token is read from the JSON body only. It is never logged: Fastify's
   * default request logging does not include bodies, and nothing below echoes
   * it back.
   */
  app.post("/v1/community/github/connect", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;

    const token = request.body?.token;
    const result = await connectGithub(caller.accountId, token);
    if (!result.ok) {
      const status =
        result.reason === "github_not_configured" ? 503
        : result.reason === "github_unavailable" ? 502
        : result.reason === "github_already_linked" ? 409
        : 400;
      return reply.code(status).send({ error: result.reason });
    }

    await recomputeRanks();
    return reply.send(result);
  });

  /** Forget the token. History and points stay. */
  app.post("/v1/community/github/disconnect", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;
    return reply.send(await disconnectGithub(caller.accountId));
  });

  /* ------------------------------------------------------------------ */
  /* Discord (Push 6) — the website's Join Discord button                */
  /* ------------------------------------------------------------------ */

  /** Members only: a single-use state and the Discord authorize URL. */
  app.post("/v1/discord/start", async (request, reply) => {
    const caller = await communityCaller(request, reply);
    if (!caller) return;
    const result = await startDiscordLink(caller.accountId);
    if (!result.ok) return reply.code(503).send({ error: result.reason });
    return reply.send({ url: result.url });
  });

  /**
   * Discord sends the member here. No login cookie is needed: the state the
   * Hub issued at start names the person, and it works once.
   */
  app.get("/v1/discord/callback", async (request, reply) => {
    const query = request.query ?? {};
    let outcome = "error";
    try {
      const result = await completeDiscordLink({
        state: query.state,
        code: query.code,
        error: query.error,
      });
      outcome = result.outcome;
      if (outcome === "error") {
        request.log.warn({ reason: result.reason }, "discord link failed");
      }
    } catch (failure) {
      request.log.error({ err: failure }, "discord callback failed");
    }
    const site = discordConfig().siteUrl;
    return reply.redirect(`${site}/?discord=${encodeURIComponent(outcome)}`, 303);
  });

  /** Disconnect: the role goes, the link goes. Never a kick. */
  app.post("/v1/discord/unlink", async (request, reply) => {
    const caller = await communityCaller(request, reply, { membersOnly: false });
    if (!caller) return;
    const result = await unlinkDiscord(caller.accountId);
    if (!result.ok) return reply.code(502).send({ error: result.reason });
    return reply.send(await buildMe(caller.accountId));
  });

  /* ------------------------------------------------------------------ */
  /* clerk webhook                                                       */
  /* ------------------------------------------------------------------ */

  app.post("/v1/webhooks/clerk", async (request, reply) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return reply.code(503).send({ error: "not_configured" });

    // verify with Svix against the raw bytes
    let event;
    try {
      const { Webhook } = await import("svix");
      event = new Webhook(secret).verify(request.rawBody ?? "", {
        "svix-id": request.headers["svix-id"],
        "svix-timestamp": request.headers["svix-timestamp"],
        "svix-signature": request.headers["svix-signature"],
      });
    } catch {
      return reply.code(400).send({ error: "invalid_signature" });
    }

    const type = event?.type;
    const data = event?.data ?? {};

    if (type === "user.updated") {
      const clerkUserId = data.id;
      const primary = (data.email_addresses ?? []).find(
        (entry) => entry.id === data.primary_email_address_id,
      );
      const verified = primary?.verification?.status === "verified";
      const email = normalizeEmail(primary?.email_address);

      if (clerkUserId && verified && email) {
        const result = await resolveAccount({
          clerkUserId,
          email,
          verified: true,
        });
        if (!result.ok) {
          request.log.warn({ type, reason: result.reason }, "clerk user.updated not applied");
        }
      }
      return reply.send({ ok: true });
    }

    if (type === "user.deleted") {
      // detach the login; keep the person and everything they own
      const clerkUserId = data.id;
      if (clerkUserId) {
        const found = await postgres.query(
          `delete from core.identities
            where provider = 'clerk' and provider_user_id = $1
            returning account_id`,
          [clerkUserId],
        );
        const accountId = found.rows[0]?.account_id;
        if (accountId) {
          const client = await postgres.connect();
          try {
            await queueReview(client, "clerk_user_deleted", accountId, {
              clerkUserId,
            });
          } finally {
            client.release();
          }
        }
      }
      return reply.send({ ok: true });
    }

    return reply.send({ ok: true, ignored: type ?? "unknown" });
  });

  return app;
}

/* -------------------------------------------------------------------- */

const isEntrypoint =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3003);
  app
    .listen({ port, host: "0.0.0.0" })
    .then(() => {
      app.log.info(`hub listening on ${port}`);
      scheduleNightlyReconcile({ log: app.log });
    })
    .catch((error) => {
      app.log.error(error);
      process.exit(1);
    });
}
