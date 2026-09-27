/**
 * Every tool the Posterract connector offers, grouped the way the product
 * is: posting, accounts, the calendar, the video library, analytics and the
 * game. Add a tool to its group's file; this list is what tools/list shows.
 */

import { ACCOUNT_TOOLS } from "./accounts.js";
import { ANALYTICS_TOOLS } from "./analytics.js";
import { CALENDAR_TOOLS } from "./calendar.js";
import { GAME_TOOLS } from "./game.js";
import { LIBRARY_TOOLS } from "./library.js";
import { POSTING_TOOLS } from "./posting.js";

export const TOOLS = [
  ...POSTING_TOOLS,
  ...ACCOUNT_TOOLS,
  ...CALENDAR_TOOLS,
  ...LIBRARY_TOOLS,
  ...ANALYTICS_TOOLS,
  ...GAME_TOOLS,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
if (TOOLS_BY_NAME.size !== TOOLS.length) throw new Error("Two MCP tools share a name");
