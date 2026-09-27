/**
 * Businesses: groups of connected accounts that a user creates, each with an
 * optional small round logo (they replaced account sets). Posting to a
 * business posts to every account in it; analytics can show one business or
 * any picked accounts.
 *
 *   GET    /v1/businesses                 every business with its accounts
 *   POST   /v1/businesses                 { name, accountIds, logo? }
 *   PUT    /v1/businesses/:id             { name, accountIds, logo? } (logo: data URL, null removes, omit keeps)
 *   DELETE /v1/businesses/:id
 *   GET    /v1/business-logos/:hash       the logo image (public, by content hash)
 *
 * Layout:
 *   index.js  the routes
 *   store.js  reading and saving
 *   logo.js   checking and serving logos
 *   scope.js  which accounts a read covers (analytics, Muse)
 */

import { randomUUID } from "node:crypto";
import { parseLogo, registerLogoRoute } from "./logo.js";
import { BusinessError, MAX_BUSINESS_ACCOUNTS, deleteBusiness, loadBusinesses, saveBusiness, uuidPattern } from "./store.js";

export { loadBusinesses } from "./store.js";
export { parseScopeQuery, resolveScopeAccounts } from "./scope.js";
export { BusinessError } from "./store.js";

function parseBusinessBody(body) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return { error: "invalid_business_name" };
  const accountIds = Array.isArray(body?.accountIds) ? [...new Set(body.accountIds)] : [];
  if (
    accountIds.length > MAX_BUSINESS_ACCOUNTS ||
    accountIds.some((id) => typeof id !== "string" || !uuidPattern.test(id))
  ) {
    return { error: "invalid_business_accounts" };
  }
  let logo;
  if (body?.logo === null) logo = null;
  else if (body?.logo !== undefined) {
    logo = parseLogo(body.logo);
    if (logo.error) return { error: logo.error };
  }
  return { name, accountIds, logo };
}

function sendError(reply, error) {
  if (error instanceof BusinessError) return reply.code(error.status).send({ error: error.code });
  throw error;
}

export function registerBusinessRoutes(app, { postgres, requireScope, requiredWorkspace, publicApiUrl }) {
  const load = (workspaceId) => loadBusinesses(postgres, workspaceId, { publicApiUrl });

  app.get(
    "/v1/businesses",
    { preHandler: requireScope("accounts:read") },
    async (request) => ({ businesses: await load(requiredWorkspace(request)) }),
  );

  app.post(
    "/v1/businesses",
    { preHandler: requireScope("accounts:write"), bodyLimit: 1024 * 1024 },
    async (request, reply) => {
      const input = parseBusinessBody(request.body);
      if (input.error) return reply.code(400).send({ error: input.error });
      const workspaceId = requiredWorkspace(request);
      const businessId = randomUUID();
      try {
        await saveBusiness(postgres, workspaceId, businessId, input, { creating: true });
      } catch (error) {
        return sendError(reply, error);
      }
      const businesses = await load(workspaceId);
      return reply.code(201).send(businesses.find((business) => business.id === businessId));
    },
  );

  app.put(
    "/v1/businesses/:id",
    { preHandler: requireScope("accounts:write"), bodyLimit: 1024 * 1024 },
    async (request, reply) => {
      if (!uuidPattern.test(request.params.id)) return reply.code(404).send({ error: "business_not_found" });
      const input = parseBusinessBody(request.body);
      if (input.error) return reply.code(400).send({ error: input.error });
      const workspaceId = requiredWorkspace(request);
      try {
        await saveBusiness(postgres, workspaceId, request.params.id, input, { creating: false });
      } catch (error) {
        return sendError(reply, error);
      }
      const businesses = await load(workspaceId);
      return businesses.find((business) => business.id === request.params.id);
    },
  );

  app.delete(
    "/v1/businesses/:id",
    { preHandler: requireScope("accounts:write") },
    async (request, reply) => {
      if (!uuidPattern.test(request.params.id)) return reply.code(404).send({ error: "business_not_found" });
      const deleted = await deleteBusiness(postgres, requiredWorkspace(request), request.params.id);
      if (!deleted) return reply.code(404).send({ error: "business_not_found" });
      return reply.code(204).send();
    },
  );

  registerLogoRoute(app, { postgres });
}
