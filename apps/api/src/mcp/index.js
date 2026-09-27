/**
 * Posterract's MCP server: the connector Meta Muse (or any MCP client) uses
 * to post and schedule videos on Instagram, Facebook and Threads, read their
 * analytics and play the points game.
 *
 * It lives at POST /v1/mcp on the API (the gateway already routes /v1/* to
 * it) and speaks MCP's Streamable HTTP transport statelessly: each request
 * carries a Posterract API key or a sign-in token (Authorization: Bearer ...;
 * see ./auth.js for the sign-in link) and gets a plain JSON reply; there are
 * no sessions and no server-sent streams.
 * Only accounts with an active plan get in, and each tool needs one of its
 * scopes on the key (see ./tools).
 *
 * Layout:
 *   index.js         the endpoint and the JSON-RPC methods
 *   auth.js          sign-in for connectors (OAuth 2.1 + PKCE, like Postiz's link)
 *   context.js       what tools get: in-process REST calls, errors, checks
 *   instructions.js  what the agent is told about Posterract
 *   safe-download.js public-link downloads for import_video_from_url
 *   tools/           one file per part of the product
 */

import { MCP_INSTRUCTIONS } from "./instructions.js";
import { ToolError, callerCan, toolContext, validateArgs } from "./context.js";
import { TOOLS, TOOLS_BY_NAME } from "./tools/index.js";

export const MCP_PATH = "/v1/mcp";
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "posterract", title: "Posterract", version: "1.0.0" };

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function describeTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...tool.annotations },
  };
}

function toolFailure(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function callTool(params, request, deps) {
  const tool = TOOLS_BY_NAME.get(params?.name);
  if (!tool) return undefined;
  if (!callerCan(request, tool)) {
    return toolFailure(
      `This connection can't use ${tool.name}. It needs one of these permissions: ${tool.scopes.join(", ")}. ` +
        "Connect Posterract again and allow it, or use a key from Posterract → API Keys that has it.",
    );
  }
  const args = params.arguments ?? {};
  const problem = validateArgs(tool.inputSchema, args);
  if (problem) return toolFailure(problem);
  try {
    const result = await tool.run(toolContext(request, deps), args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (error) {
    if (error instanceof ToolError) return toolFailure(error.message);
    request.log.error({ err: error, tool: tool.name }, "mcp tool failed");
    return toolFailure("Posterract hit an unexpected error. Try again in a minute.");
  }
}

/** Handles one JSON-RPC message. Returns the reply, or undefined for notifications. */
async function handleMessage(message, request, deps) {
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id ?? null, -32600, "Invalid request");
  }
  const isNotification = !("id" in message);
  if (isNotification) return undefined;
  const { id, method, params } = message;
  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      // Only the tools this key can use, so an agent never tests one that will refuse it.
      return rpcResult(id, { tools: TOOLS.filter((tool) => callerCan(request, tool)).map(describeTool) });
    case "tools/call": {
      const result = await callTool(params, request, deps);
      return result ? rpcResult(id, result) : rpcError(id, -32602, `Unknown tool: ${params?.name}`);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Registers the endpoint. `authenticate` is the API's product-access check
 * (a valid key or session on a workspace with an active plan).
 */
export function registerMcpRoutes(app, { postgres, authenticate, resourceMetadataUrl }) {
  const deps = { app, postgres };
  // A 401 points MCP clients at the sign-in (OAuth) details, so they can send the user a sign-in link.
  const challenge = resourceMetadataUrl
    ? `Bearer realm="posterract", resource_metadata="${resourceMetadataUrl}"`
    : 'Bearer realm="posterract"';

  app.post(
    MCP_PATH,
    {
      preHandler: authenticate,
      onSend: async (request, reply, payload) => {
        if (reply.statusCode === 401) reply.header("www-authenticate", challenge);
        return payload;
      },
    },
    async (request, reply) => {
      const body = request.body;
      if (Array.isArray(body)) {
        const replies = (await Promise.all(body.map((message) => handleMessage(message, request, deps)))).filter(Boolean);
        return replies.length ? replies : reply.code(202).send();
      }
      const response = await handleMessage(body, request, deps);
      return response ?? reply.code(202).send();
    },
  );

  // Stateless: no server-to-client stream to open, and no session to end.
  for (const method of ["GET", "DELETE"]) {
    app.route({
      method,
      url: MCP_PATH,
      handler: async (_request, reply) => reply.code(405).header("allow", "POST").send({ error: "method_not_allowed" }),
    });
  }
}
