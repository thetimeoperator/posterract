/**
 * Accounts and businesses: where posts can go. A business is a group of
 * accounts the user made (any accounts, even two on one platform); posting to
 * a business posts to every account in it.
 */

import { CONNECTOR_PLATFORMS } from "../context.js";

const reachable = (account) => CONNECTOR_PLATFORMS.includes(account.provider);

/** The caller's Instagram, TikTok, Facebook and Threads accounts, and their businesses. */
export async function loadTargets(context) {
  const [{ accounts }, { businesses }] = await Promise.all([
    context.api("GET", "/v1/accounts"),
    context.api("GET", "/v1/businesses"),
  ]);
  return {
    accounts: accounts.filter(reachable),
    businesses: businesses
      .map((business) => ({ ...business, accounts: business.accounts.filter(reachable) }))
      .filter((business) => business.accounts.length > 0),
  };
}

export const describeAccount = (account) => ({
  id: account.id,
  platform: account.provider,
  handle: account.handle,
  ...(account.displayName ? { name: account.displayName } : {}),
  can_post: account.status === "connected",
  ...(account.status !== "connected" ? { needs: "Reconnect this account in Posterract → Social accounts." } : {}),
});

export const listAccounts = {
  name: "list_accounts",
  title: "List connected accounts",
  description:
    "Lists the Instagram, TikTok, Facebook and Threads accounts connected to Posterract, and the user's businesses " +
    "(groups of accounts they made, e.g. one per brand; posting to a business posts to all its accounts, even two " +
    "on one platform). Call this before create_post: it takes account ids or a business id from here.",
  scopes: ["accounts:read"],
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  async run(context) {
    const { accounts, businesses } = await loadTargets(context);
    return {
      accounts: accounts.map(describeAccount),
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name,
        accounts: business.accounts.map(describeAccount),
      })),
      ...(accounts.length === 0
        ? { note: "No Instagram, TikTok, Facebook or Threads accounts are connected yet. Connect them in Posterract → Social accounts." }
        : {}),
    };
  },
};

export const ACCOUNT_TOOLS = [listAccounts];
