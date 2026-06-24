// Quality gate = inclusion decision, separate from ranking.
//   • DROP — not a real endpoint (no usable summary / stub / meta-well-known path), OR too
//            thin (fewer than MIN_FIELDS of the fleshed-out fields filled).
//   • PASS — a real, reasonably-fleshed endpoint → indexed, carrying a `completeness` score
//            and quality `flags` that drive RANKING.
import type { EndpointRecord } from "./types.js";

export type GateVerdict = "pass" | "drop";
export interface GateResult {
  verdict: GateVerdict;
  reasons: string[];
  flags: string[];
  /** Count of fleshed-out fields filled (0..FLESH_MAX) — the ranking completeness score. */
  completeness: number;
}

const META_FILE = /(\/\.well-known\/|\/robots\.txt|\/llms\.txt|sitemap|\/favicon|openapi\.json|swagger\.json)/i;
const META_PATH = /^\/(api\/)?(health|healthz|status|ping|metrics|version|info)\/?$/i;
const STUB = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i;

// Content-free boilerplate: a non-stub string that nonetheless conveys no capability — e.g.
// one provider stamping "Premium API Access" across 10k templated endpoints. The dense
// embedder gets no signal from these, so the binder misfires on path tokens. Seed list of
// proven offenders; extend as new ones surface. (A bare price like "0.01 USDC on Base" is
// content-free too.) Exact-match on the normalized string keeps it deterministic and tight.
const CONTENT_FREE = new Set([
  "premium api access",
  "premium api",
  "api access",
  "access to protected content",
  "protected content",
  "handler",
  "endpoint",
  "api endpoint",
  "protected endpoint",
]);
const BARE_PRICE = /^\$?\d[\d.,]*\s?(usdc?|usd|eth|dai|sol|matic)(\s+(on|per)\s+[\w-]+)?$/i;
/** True when a text string is empty or pure boilerplate that conveys no capability. */
function isContentFree(text: string | undefined): boolean {
  const s = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return true;
  return CONTENT_FREE.has(s) || BARE_PRICE.test(s);
}

/** The fields that make an endpoint "fleshed out" (mapped to the AgentCash A+ rubric). */
const FLESH_FIELDS: Array<(e: EndpointRecord) => boolean> = [
  (e) => !!(e.summary ?? "").trim(),
  (e) => !!(e.description ?? "").trim(),
  (e) => !!e.operation_id,
  (e) => (e.tags ?? []).length > 0,
  (e) => (e.inputs ?? []).length > 0,
  (e) => e.payment?.price_usd != null,
  (e) => (e.payment?.offers ?? []).length > 0,
  (e) => (e.payment?.rails ?? []).length > 0,
  (e) => !!e.payment?.currency,
  (e) => (e.service?.categories ?? []).length > 0,
  (e) => !!(e.service?.docs && Object.keys(e.service.docs).length),
  (e) => e.responses?.has402 === true,
  (e) => !!e.provider_title,
];
export const FLESH_MAX = FLESH_FIELDS.length;
/** Per-endpoint completeness score: how many fleshed-out fields are filled. */
export function completeness(ep: EndpointRecord): number {
  let c = 0;
  for (const f of FLESH_FIELDS) if (f(ep)) c += 1;
  return c;
}
/** Minimum filled fields to be indexed; ≤ (MIN_FIELDS-1) is gated out as too thin. */
export const MIN_FIELDS = 5;

export function gradeEndpoint(ep: EndpointRecord): GateResult {
  const summary = (ep.summary ?? "").trim();
  const path = ep.path ?? "";
  const comp = completeness(ep);

  // DROP — not a real endpoint.
  if (META_FILE.test(path) || META_PATH.test(path)) return { verdict: "drop", reasons: ["meta/well-known path"], flags: [], completeness: comp };
  if (!summary || STUB.test(summary)) return { verdict: "drop", reasons: ["stub: synthesized summary"], flags: [], completeness: comp };
  // DROP — summary is content-free boilerplate with no real description to fall back on
  // (e.g. "Premium API Access" stamped across a provider's whole catalog). Conveys no capability.
  if (isContentFree(summary) && isContentFree(ep.description)) return { verdict: "drop", reasons: ["content-free summary (boilerplate)"], flags: [], completeness: comp };
  // DROP — too thin to be useful.
  if (comp < MIN_FIELDS) return { verdict: "drop", reasons: [`thin: only ${comp}/${FLESH_MAX} fields filled`], flags: [], completeness: comp };

  // PASS — quality flags drive ranking; they never exclude.
  const offers = ep.payment?.offers ?? [];
  const rails = ep.payment?.rails ?? [];
  const hasPayment = (ep.payment?.paid ?? false) || offers.length > 0 || ep.payment?.price_usd != null || rails.length > 0;
  const flags: string[] = [];
  if (!hasPayment) flags.push("no-payment-detected");
  else {
    if (offers.length === 0) flags.push("legacy-payment");
    if (ep.payment?.price_usd == null) flags.push("price-dynamic-or-unknown");
  }
  if (ep.schema_missing) flags.push("schema-missing");
  if (offers.length > 0 && ep.responses?.has402 === false) flags.push("no-402-declared");

  return { verdict: "pass", reasons: [], flags, completeness: comp };
}

export interface GateSummary {
  total: number;
  pass: number;
  drop: number;
  reasons: Record<string, number>;
  flags: Record<string, number>;
  avg_completeness: number;
}

export function gradeAll(records: EndpointRecord[]): GateSummary {
  const s: GateSummary = { total: records.length, pass: 0, drop: 0, reasons: {}, flags: {}, avg_completeness: 0 };
  let passComp = 0;
  for (const ep of records) {
    const r = gradeEndpoint(ep);
    s[r.verdict] += 1;
    for (const x of r.reasons) s.reasons[x] = (s.reasons[x] ?? 0) + 1;
    for (const x of r.flags) s.flags[x] = (s.flags[x] ?? 0) + 1;
    if (r.verdict === "pass") passComp += r.completeness;
  }
  s.avg_completeness = s.pass ? passComp / s.pass : 0;
  return s;
}
