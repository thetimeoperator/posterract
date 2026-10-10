import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createHubClient, registerSavagesRoutes } from "../src/savages.js";

const OWNER = "00000000-0000-4000-8000-000000000001";

function fakeRedis() {
  const counts = new Map();
  return {
    incr: async (key) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    expire: async () => 1,
  };
}

function appWith(answer, { role = "owner" } = {}) {
  const app = Fastify();
  const calls = [];
  registerSavagesRoutes(app, {
    hub: async (path, init = {}) => {
      calls.push({ path, ...init });
      return answer(path, init);
    },
    redis: fakeRedis(),
    clientAddress: () => "203.0.113.7",
    requireInteractiveSession: async (request) => {
      request.authContext = { kind: "session", userId: OWNER, role };
    },
  });
  return { app, calls };
}

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_live_abc";
const ok = (data) => ({ ok: true, status: 200, data });

test("the landing's checkout asks the Hub for a guest checkout and returns Stripe's page", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { url: STRIPE_URL });
  assert.deepEqual(calls, [{ path: "/v1/service/posterract/checkout", method: "POST", body: { plan: "monthly" } }]);
});

test("an unknown plan never reaches the Hub", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "weekly" } });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("the in-app upgrade sends the signed-in owner", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "yearly" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls[0].body, { plan: "yearly", accountId: OWNER });
});

test("only the workspace owner can upgrade", async () => {
  const { app, calls } = appWith(() => ok({ url: STRIPE_URL }), { role: "editor" });
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 403);
  assert.equal(calls.length, 0);
});

test("already a member answers 409", async () => {
  const { app } = appWith(() => ({ ok: false, status: 409, error: "already_a_member" }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout/member", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 409);
});

test("the Hub being down is a 503, never a crash", async () => {
  const { app } = appWith(() => ({ ok: false, status: 0, error: "hub_unreachable" }));
  const response = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "checkout_unavailable" });
});

test("plans are cached", async () => {
  const plans = [{ id: "monthly", amount: 5999, currency: "usd", interval: "month" }];
  const { app, calls } = appWith(() => ok({ plans }));
  for (let index = 0; index < 2; index += 1) {
    const response = await app.inject({ method: "GET", url: "/v1/savages/plans" });
    assert.deepEqual(response.json(), { plans });
  }
  assert.equal(calls.length, 1);
});

test("status: a malformed session id is refused before the Hub", async () => {
  const { app, calls } = appWith(() => ok({ state: "active" }));
  const response = await app.inject({ method: "GET", url: "/v1/savages/checkout/not-a-session" });
  assert.equal(response.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("status passes only its four fields through", async () => {
  const { app } = appWith(() => ok({ state: "active", email: "b@example.test", plan: "monthly", hasPosterractLogin: false, accountId: "secret-ish" }));
  const response = await app.inject({ method: "GET", url: "/v1/savages/checkout/cs_live_a1b2c3d4e5f6" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { state: "active", email: "b@example.test", plan: "monthly", hasPosterractLogin: false });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("the landing's checkout is rate limited per visitor", async () => {
  const { app } = appWith(() => ok({ url: STRIPE_URL }));
  let last;
  for (let index = 0; index < 11; index += 1) {
    last = await app.inject({ method: "POST", url: "/v1/savages/checkout", payload: { plan: "monthly" } });
  }
  assert.equal(last.statusCode, 429);
});

test("the Hub client sends the service key and never throws", async () => {
  let seen;
  const hub = createHubClient({
    environment: { HUB_SERVICE_KEY: "test-key", HUB_INTERNAL_URL: "http://hub:3003/" },
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ plans: [] }), { status: 200 });
    },
  });
  assert.deepEqual(await hub("/v1/service/posterract/plans"), { ok: true, status: 200, data: { plans: [] } });
  assert.equal(seen.url, "http://hub:3003/v1/service/posterract/plans");
  assert.equal(seen.init.headers.authorization, "Bearer test-key");

  const keyless = createHubClient({ environment: {} });
  assert.deepEqual(await keyless("/x"), { ok: false, status: 503, error: "hub_not_configured" });

  const broken = createHubClient({ environment: { HUB_SERVICE_KEY: "k" }, fetchImpl: async () => { throw new Error("down"); } });
  assert.deepEqual(await broken("/x"), { ok: false, status: 0, error: "hub_unreachable" });
});
