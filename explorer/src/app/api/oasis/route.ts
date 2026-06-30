import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Single proxy to the OASIS MCP. The browser POSTs { tool, args }; this route
 * calls the named tool and returns its JSON payload. Defaults to a local MCP
 * over the local index; set OASIS_MCP_URL to the deployed MCP in production.
 */
const MCP_URL = process.env.OASIS_MCP_URL ?? "http://localhost:8899/mcp";

const ALLOWED = new Set(["oasis_search", "oasis_find", "oasis_resolve", "oasis_next"]);

export async function POST(request: Request) {
  let tool = "";
  let args: Record<string, unknown> = {};
  try {
    ({ tool, args = {} } = await request.json());
  } catch {
    /* ignore */
  }
  if (!ALLOWED.has(tool)) {
    return NextResponse.json({ error: `tool not allowed: ${tool}` }, { status: 400 });
  }

  const client = new Client({ name: "oasis-atlas", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
    const res = await client.callTool({ name: tool, arguments: args });
    const content = res.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.find((c) => c.type === "text")?.text ?? "{}";
    return NextResponse.json({ data: JSON.parse(text), source: MCP_URL });
  } catch (error) {
    return NextResponse.json({ data: null, error: String(error) }, { status: 200 });
  } finally {
    await client.close().catch(() => {});
  }
}
