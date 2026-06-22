#!/usr/bin/env node
// Local stdio MCP server exposing OASIS discovery (oasis_search) + query-aware
// resolve (oasis_resolve). Install via your MCP client config, e.g.:
//   { "mcpServers": { "oasis": { "command": "node",
//       "args": ["/abs/path/OASIS/mcp/server.mjs"] } } }
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOLS, handleTool } from "./tools.mjs";

const server = new Server(
  { name: "oasis", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await handleTool(req.params.name, req.params.arguments);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

await server.connect(new StdioServerTransport());
console.error("oasis MCP server ready (stdio): oasis_search, oasis_resolve");
