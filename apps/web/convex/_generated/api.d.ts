/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as analytics from "../analytics.js";
import type * as artifacts from "../artifacts.js";
import type * as auth from "../auth.js";
import type * as connectors_facebook from "../connectors/facebook.js";
import type * as connectors_instagram from "../connectors/instagram.js";
import type * as connectors_threads from "../connectors/threads.js";
import type * as connectors_tiktok from "../connectors/tiktok.js";
import type * as connectors_youtube from "../connectors/youtube.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib from "../lib.js";
import type * as metaAnalytics from "../metaAnalytics.js";
import type * as oauth from "../oauth.js";
import type * as points from "../points.js";
import type * as portals from "../portals.js";
import type * as publish from "../publish.js";
import type * as publishHelpers from "../publishHelpers.js";
import type * as publishNode from "../publishNode.js";
import type * as tiktokAnalytics from "../tiktokAnalytics.js";
import type * as transmissions from "../transmissions.js";
import type * as workspaces from "../workspaces.js";
import type * as youtubeAnalytics from "../youtubeAnalytics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  analytics: typeof analytics;
  artifacts: typeof artifacts;
  auth: typeof auth;
  "connectors/facebook": typeof connectors_facebook;
  "connectors/instagram": typeof connectors_instagram;
  "connectors/threads": typeof connectors_threads;
  "connectors/tiktok": typeof connectors_tiktok;
  "connectors/youtube": typeof connectors_youtube;
  crons: typeof crons;
  events: typeof events;
  http: typeof http;
  lib: typeof lib;
  metaAnalytics: typeof metaAnalytics;
  oauth: typeof oauth;
  points: typeof points;
  portals: typeof portals;
  publish: typeof publish;
  publishHelpers: typeof publishHelpers;
  publishNode: typeof publishNode;
  tiktokAnalytics: typeof tiktokAnalytics;
  transmissions: typeof transmissions;
  workspaces: typeof workspaces;
  youtubeAnalytics: typeof youtubeAnalytics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
