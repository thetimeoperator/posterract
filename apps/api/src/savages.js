/**
 * AI FOR SAVAGES, sold from Posterract: the landing page's second payment
 * option, and the upgrade a Pro workspace is offered when all ten of its
 * account slots are in use.
 *
 * The Hub (apps/hub, its own container on the VPS) owns everything about the
 * membership: the prices, the Stripe checkout, the people list and who is a
 * member. These routes only pass requests to it over the VPS's internal
 * network with the Hub's service key. Nothing here creates a Stripe object or
 * writes a core.* table.
 */

const PLAN_IDS = ["monthly", "yearly", "lifetime"];
const SESSION_ID = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const PLAN_BODY = {
  type: "object",
  required: ["plan"],
  additionalProperties: false,
  properties: { plan: { type: "string", enum: PLAN_IDS } },
};

/** One call to the Hub. Never throws: a failure comes back as { ok: false }. */
export function createHubClient({ environment = process.env, fetchImpl = fetch } = {}) {
  const baseUrl = String(environment.HUB_INTERNAL_URL || "http://hub:3003").replace(/\/+$/, "");
  const key = environment.HUB_SERVICE_KEY || "";
  return async function hub(path, { method = "GET", body } = {}) {
    if (!key) return { ok: false, status: 503, error: "hub_not_configured" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return response.ok
        ? { ok: true, status: response.status, data }
        : { ok: false, status: response.status, error: data?.error ?? `hub_http_${response.status}` };
    } catch (error) {
      return { ok: false, status: 0, error: error?.name === "AbortError" ? "hub_timeout" : "hub_unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** A per-visitor limit for the public routes, in Redis like /v1/contact's. */
async function overLimit(redis, key, max) {
  const minute = Math.floor(Date.now() / 60_000);
  const rateKey = `posterract:savages-rate:${key}:${minute}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 120);
  return count > max;
}

export function registerSavagesRoutes(app, { hub, redis, clientAddress, requireInteractiveSession }) {
  let plansCache;

  // The three plans' live Stripe prices, for the landing's card and the
  // upgrade buttons. Public; cached ten minutes.
  app.get("/v1/savages/plans", async (_request, reply) => {
    if (plansCache && plansCache.expiresAt > Date.now()) return plansCache.value;
    const result = await hub("/v1/service/posterract/plans");
    if (!result.ok || !Array.isArray(result.data?.plans) || result.data.plans.length === 0) {
      return reply.code(503).send({ error: "savages_unavailable" });
    }
    plansCache = { value: { plans: result.data.plans }, expiresAt: Date.now() + 10 * 60_000 };
    return plansCache.value;
  });

  // The landing page's button: Stripe Checkout for someone with no account.
  app.post("/v1/savages/checkout", { schema: { body: PLAN_BODY } }, async (request, reply) => {
    if (await overLimit(redis, `checkout:${clientAddress(request)}`, 10)) {
      reply.header("retry-after", 60);
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
    const result = await hub("/v1/service/posterract/checkout", {
      method: "POST",
      body: { plan: request.body.plan },
    });
    if (result.ok && typeof result.data?.url === "string") return { url: result.data.url };
    request.log.error({ status: result.status, error: result.error }, "AI FOR SAVAGES checkout failed");
    return reply.code(503).send({ error: "checkout_unavailable" });
  });

  // The upgrade buttons in the app: the membership lands on the signed-in
  // owner (the account limit follows the owner's membership).
  app.post(
    "/v1/savages/checkout/member",
    { preHandler: requireInteractiveSession, schema: { body: PLAN_BODY } },
    async (request, reply) => {
      if (request.authContext?.role !== "owner") {
        return reply.code(403).send({ error: "owner_only" });
      }
      const result = await hub("/v1/service/posterract/checkout", {
        method: "POST",
        body: { plan: request.body.plan, accountId: request.authContext.userId },
      });
      if (result.ok && typeof result.data?.url === "string") return { url: result.data.url };
      if (result.status === 409) return reply.code(409).send({ error: "already_a_member" });
      request.log.error({ status: result.status, error: result.error }, "AI FOR SAVAGES member checkout failed");
      return reply.code(503).send({ error: "checkout_unavailable" });
    },
  );

  // The welcome page after Stripe: is the payment in, and for which email?
  // Asking also records the purchase if Stripe's webhook has not yet.
  app.get("/v1/savages/checkout/:sessionId", async (request, reply) => {
    const { sessionId } = request.params;
    if (!SESSION_ID.test(sessionId)) return reply.code(400).send({ error: "invalid_session_id" });
    if (await overLimit(redis, `status:${clientAddress(request)}`, 120)) {
      reply.header("retry-after", 60);
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
    reply.header("cache-control", "no-store");
    const result = await hub("/v1/service/posterract/checkout-status", {
      method: "POST",
      body: { sessionId },
    });
    if (!result.ok) return reply.code(503).send({ error: "status_unavailable" });
    const { state, email, plan, hasPosterractLogin } = result.data ?? {};
    return { state, email, plan, hasPosterractLogin };
  });
}
