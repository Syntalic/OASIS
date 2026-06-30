import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Proxy to the OASIS MCP's `oasis_search` (the real semantic binder). Defaults
 * to a local MCP over the local index; point OASIS_MCP_URL at the deployed MCP
 * in production. The browser never talks MCP directly (CORS / session / key);
 * this server route does, and just returns ranked capability intent ids.
 */
const MCP_URL = process.env.OASIS_MCP_URL ?? "http://localhost:8899/mcp";

interface SearchCapability {
  intent_id: string;
  label?: string;
  summary?: string;
}

export async function POST(request: Request) {
  let query = "";
  try {
    ({ query } = await request.json());
  } catch {
    /* ignore */
  }
  if (!query?.trim()) return NextResponse.json({ capabilities: [] });

  const client = new Client({ name: "oasis-atlas", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
    const res = await client.callTool({
      name: "oasis_search",
      arguments: { query, limit: 8 },
    });
    const content = res.content as Array<{ type: string; text?: string }> | undefined;
    const text = content?.find((c) => c.type === "text")?.text ?? "{}";
    const data = JSON.parse(text) as { capabilities?: SearchCapability[] };
    return NextResponse.json({ capabilities: data.capabilities ?? [], source: MCP_URL });
  } catch (error) {
    // surface the failure so the client can fall back to the local scorer
    return NextResponse.json({ capabilities: [], error: String(error) }, { status: 200 });
  } finally {
    await client.close().catch(() => {});
  }
}
