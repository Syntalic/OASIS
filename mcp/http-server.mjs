#!/usr/bin/env node
// Streamable-HTTP MCP server for OASIS — the SAME tools + handlers as the stdio
// server (server.mjs / tools.mjs), exposed over HTTP for remote hosting (e.g. Fly.io).
//
// Stateless: a fresh MCP server + transport per request. The OASIS tools are
// read-only request/response (no session state), so this scales cleanly and works
// with scale-to-zero. The heavy state (83MB index, LanceDB vectors, the embedding
// model) is loaded ONCE at import time by tools.mjs and shared across requests.
//
//   GET  /health  -> liveness JSON (used by the Fly health check)
//   POST /mcp     -> MCP Streamable HTTP endpoint (bearer-auth if OASIS_AUTH_TOKEN set)
//
// Env: PORT (default 8080), MCP_PATH (default /mcp), OASIS_AUTH_TOKEN (if set, require
//      `Authorization: Bearer <token>`), MCP_JSON_RESPONSE (default "1" -> plain JSON
//      responses instead of SSE; set "0" to stream).
import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOLS, handleTool } from "./tools.mjs";

const PORT = Number(process.env.PORT || 8080);
const MCP_PATH = process.env.MCP_PATH || "/mcp";
const AUTH = process.env.OASIS_AUTH_TOKEN || ""; // if set, require a matching bearer token
const JSON_RESPONSE = process.env.MCP_JSON_RESPONSE !== "0"; // default: plain JSON, not SSE
const MAX_BODY = 4_000_000;
// Open-but-rate-limited: the public instance runs without a token, so a per-IP fixed
// window keeps it usable without letting anyone hammer the single machine (each call
// runs a real embedding + vector search). 0 disables.
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 60); // requests per window per IP
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS ?? 60_000);
const rateHits = new Map(); // ip -> { count, resetAt }

function makeServer() {
  const server = new Server(
    { name: "oasis", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const result = await handleTool(req.params.name, req.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
  return server;
}

// Constant-time-ish bearer check (length-guarded equality is fine for a shared token).
function authorized(req) {
  if (!AUTH) return true;
  return (req.headers["authorization"] || "") === `Bearer ${AUTH}`;
}

// Real client IP behind Fly's proxy (Fly-Client-IP), falling back to XFF / socket.
function clientIp(req) {
  return (
    req.headers["fly-client-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

// Per-IP fixed-window limiter. Returns true (and sends 429) when over budget.
function rateLimited(req, res) {
  if (RATE_LIMIT <= 0) return false;
  const now = Date.now();
  const ip = clientIp(req);
  let e = rateHits.get(ip);
  if (!e || e.resetAt <= now) {
    e = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateHits.set(ip, e);
  }
  e.count += 1;
  if (rateHits.size > 20_000) {
    for (const [k, v] of rateHits) if (v.resetAt <= now) rateHits.delete(k); // bound memory
  }
  if (e.count > RATE_LIMIT) {
    const retry = Math.ceil((e.resetAt - now) / 1000);
    res.setHeader("retry-after", String(retry));
    sendJson(res, 429, { error: "rate limit exceeded", retry_after_s: retry });
    return true;
  }
  return false;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const httpServer = http.createServer(async (req, res) => {
  // Permissive CORS — harmless for server-side agents, required for browser MCP clients.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version, last-event-id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/health" || urlPath === "/") {
    return sendJson(res, 200, { status: "ok", server: "oasis", tools: MCP_TOOLS.map((t) => t.name) });
  }
  if (urlPath !== MCP_PATH) return sendJson(res, 404, { error: "not found" });

  if (rateLimited(req, res)) return;
  if (!authorized(req)) {
    res.setHeader("www-authenticate", "Bearer");
    return sendJson(res, 401, { error: "unauthorized" });
  }

  // Stateless: new MCP server + transport per request; closed when the response ends.
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: JSON_RESPONSE,
  });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("request error:", err?.message || err);
    if (!res.headersSent) sendJson(res, 400, { error: "bad request" });
  }
});

httpServer.listen(PORT, () => {
  console.error(
    `oasis MCP (streamable http) listening on :${PORT}${MCP_PATH} — ` +
      `tools: ${MCP_TOOLS.map((t) => t.name).join(", ")} ` +
      `[auth: ${AUTH ? "on" : "OFF"}, rate: ${RATE_LIMIT > 0 ? `${RATE_LIMIT}/${RATE_WINDOW_MS / 1000}s/ip` : "off"}, json: ${JSON_RESPONSE}]`,
  );
});
