// Provider-agnostic agent harness for the OASIS probe. Drives ANY LLM through the
// OASIS tools (search -> resolve -> pick) and reports where it landed. Two NATIVE
// paths (no shims) — select with LLM_PROVIDER:
//
//   LLM_PROVIDER=anthropic  (default)  -> @anthropic-ai/sdk
//       ANTHROPIC_API_KEY, model = LLM_MODEL | PROBE_MODEL | claude-sonnet-4-6
//
//   LLM_PROVIDER=openai                -> openai SDK (OpenAI-compatible endpoint)
//       works with OpenAI, OpenRouter, Together, Groq, Ollama, LM Studio, vLLM, ...
//       LLM_API_KEY  | OPENAI_API_KEY
//       LLM_BASE_URL | OPENAI_BASE_URL   (default https://api.openai.com/v1)
//       LLM_MODEL    | OPENAI_MODEL      (default gpt-4o-mini)
//
// Default provider: anthropic if ANTHROPIC_API_KEY is set, else openai.
import { ANTHROPIC_TOOLS, OPENAI_TOOLS, handleTool } from "./tools.mjs";

const MAX_ROUNDS = 6;
const MAX_TOKENS = 1024;

const anthropicModel = () =>
  process.env.LLM_MODEL || process.env.PROBE_MODEL || "claude-sonnet-4-6";
const openaiModel = () =>
  process.env.LLM_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const openaiBaseURL = () =>
  process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const openaiKey = () => process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";

export function resolveProvider() {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (explicit === "anthropic" || explicit === "openai") return explicit;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
}

export function providerLabel() {
  return resolveProvider() === "anthropic"
    ? `anthropic:${anthropicModel()}`
    : `openai:${openaiModel()} @ ${openaiBaseURL()}`;
}

// Shared bookkeeping so both paths report identical { resolved, searchTop3, calls }.
const tracker = () => ({ resolved: [], searchTop3: [], calls: 0 });
async function callTool(t, name, args, handle) {
  t.calls += 1;
  if (name === "oasis_resolve" && args?.intent_id) t.resolved.push(args.intent_id);
  const out = await handle(name, args ?? {});
  if (name === "oasis_search" && t.searchTop3.length === 0) {
    t.searchTop3 = (out.capabilities ?? []).slice(0, 3).map((c) => c.intent_id);
  }
  return out;
}

async function runAnthropic({ system, query, tools, handle }) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const model = anthropicModel();
  const messages = [{ role: "user", content: query }];
  const t = tracker();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await client.messages.create({
      model, max_tokens: MAX_TOKENS, system, tools, messages,
    });
    messages.push({ role: "assistant", content: resp.content });
    const toolUses = resp.content.filter((c) => c.type === "tool_use");
    if (toolUses.length === 0) {
      const text = resp.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      return { ...t, final: text };
    }
    const results = [];
    for (const tu of toolUses) {
      const out = await callTool(t, tu.name, tu.input, handle);
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return { ...t, final: "(max rounds)" };
}

async function runOpenAI({ system, query, tools, handle }) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: openaiKey(), baseURL: openaiBaseURL() });
  const model = openaiModel();
  const messages = [
    { role: "system", content: system },
    { role: "user", content: query },
  ];
  const t = tracker();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await client.chat.completions.create({
      model, max_tokens: MAX_TOKENS, messages, tools, tool_choice: "auto",
    });
    const msg = resp.choices[0].message;
    messages.push(msg);
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) return { ...t, final: msg.content ?? "" };
    for (const tc of toolCalls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* leave empty */ }
      const out = await callTool(t, tc.function.name, args, handle);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out) });
    }
  }
  return { ...t, final: "(max rounds)" };
}

/** Run one task through the configured provider's agent loop. Toolset + handler are
 *  pluggable (default: OASIS) so the same loop drives baseline backends too.
 *  Returns { resolved, searchTop3, calls, final }. */
export async function runAgent({
  system,
  query,
  anthropicTools = ANTHROPIC_TOOLS,
  openaiTools = OPENAI_TOOLS,
  handle = handleTool,
}) {
  return resolveProvider() === "openai"
    ? runOpenAI({ system, query, tools: openaiTools, handle })
    : runAnthropic({ system, query, tools: anthropicTools, handle });
}

/** One-shot completion (no tools), provider-agnostic. Used by the compare harness'
 *  method-neutral judge. Returns the reply text. */
export async function simpleComplete({ system, user, maxTokens = 8 }) {
  if (resolveProvider() === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: openaiKey(), baseURL: openaiBaseURL() });
    const resp = await client.chat.completions.create({
      model: openaiModel(),
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return resp.choices[0]?.message?.content ?? "";
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: anthropicModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return resp.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}
