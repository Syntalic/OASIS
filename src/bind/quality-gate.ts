// Quality gate = inclusion decision, separate from ranking.
//
// Structure:
//   1. Hard DROP — junk paths / stubs / boilerplate
//   2. Required CORE — agent-usable docs + callability (+ payment signal if paid)
//   3. Completeness score (0..13) — soft ranking substrate; MIN_FIELDS still drops ultra-thin
//   4. PASS flags — never exclude (legacy payment, unverified, etc.)
//
// Completeness is "any N of 13 flesh fields". Required core is NOT that — it demands
// specific documentation/callability signals so a reliable free companion endpoint
// (good summary + inputs, no price) is not dropped while a hollow paid stub passes.
import type { EndpointRecord } from "../core/types.js";

export type GateVerdict = "pass" | "drop";
export interface GateResult {
  verdict: GateVerdict;
  reasons: string[];
  flags: string[];
  /** Count of fleshed-out fields filled (0..FLESH_MAX) — ranking completeness score. */
  completeness: number;
}

const META_FILE = /(\/\.well-known\/|\/robots\.txt|\/llms\.txt|sitemap|\/favicon|openapi\.json|swagger\.json)/i;
const META_PATH = /^\/(api\/)?(health|healthz|status|ping|metrics|version|info)\/?$/i;
const STUB = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i;
const PREVIEW_HOST = /-git-[a-z0-9-]+\.vercel\.app$/i;

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

/**
 * Minimum useful summary length when description is absent.
 * 32 catches short but real lines like "Detach a custom domain from a site."
 * (stableupload) without admitting one-word stubs.
 */
export const MIN_SUMMARY_CHARS = 32;
/** Minimum description length when used to compensate for a short summary. */
export const MIN_DESCRIPTION_CHARS = 32;

function isContentFree(text: string | undefined): boolean {
  const s = (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return true;
  return CONTENT_FREE.has(s) || BARE_PRICE.test(s);
}

/** The fields that make an endpoint "fleshed out" (soft completeness score). */
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

export function completeness(ep: EndpointRecord): number {
  let c = 0;
  for (const f of FLESH_FIELDS) if (f(ep)) c += 1;
  return c;
}

/**
 * Soft floor on flesh count. Secondary to required core — stops utterly empty shells.
 * Free companion ops of good APIs often sit at 5 flesh points (no payment fields); core
 * can still pass them. Paid shells need payment flesh + core, so they clear 6 easily.
 */
export const MIN_FIELDS = 5;

/** True when this record claims to be a paid operation. */
export function isClaimedPaid(ep: EndpointRecord): boolean {
  return (
    ep.payment?.paid === true ||
    (ep.payment?.rails?.length ?? 0) > 0 ||
    (ep.payment?.offers?.length ?? 0) > 0 ||
    ep.payment?.price_usd != null
  );
}

/**
 * Required documentation / callability core (always).
 * - Substantial summary (≥40 chars) OR substantial description (≥40 chars)
 * - Callability: ≥1 input name, or path template params `{id}`, or captured schema ref
 */
export function hasDocCore(ep: EndpointRecord): { ok: boolean; reason?: string } {
  const summary = (ep.summary ?? "").replace(/\s+/g, " ").trim();
  const desc = (ep.description ?? "").replace(/\s+/g, " ").trim();

  if (!summary || STUB.test(summary)) {
    return { ok: false, reason: "core: missing or stub summary" };
  }
  if (isContentFree(summary) && isContentFree(desc)) {
    return { ok: false, reason: "core: content-free summary/description" };
  }

  const hasSubstantialText =
    summary.length >= MIN_SUMMARY_CHARS || desc.length >= MIN_DESCRIPTION_CHARS;
  if (!hasSubstantialText) {
    return {
      ok: false,
      reason: `core: need summary≥${MIN_SUMMARY_CHARS} chars or description≥${MIN_DESCRIPTION_CHARS} chars`,
    };
  }

  const pathParams = (ep.path.match(/\{[^}]+\}|:[A-Za-z_][\w]*/g) ?? []).length;
  const hasInputs = (ep.inputs?.length ?? 0) > 0;
  const hasSchema = !!(ep.input_schema_ref || ep.output_schema_ref);
  if (!hasInputs && pathParams === 0 && !hasSchema) {
    return {
      ok: false,
      reason: "core: no inputs, path params, or captured schema (not callable)",
    };
  }

  return { ok: true };
}

/**
 * Required payment core — only for claimed-paid ops.
 * Free companions (activate, list, status) must NOT need price/rails.
 */
export function hasPaymentCore(ep: EndpointRecord): { ok: boolean; reason?: string } {
  if (!isClaimedPaid(ep)) return { ok: true };
  const hasRail = (ep.payment?.rails?.length ?? 0) > 0;
  const hasOffer = (ep.payment?.offers?.length ?? 0) > 0;
  const hasPrice = ep.payment?.price_usd != null;
  if (hasRail || hasOffer || hasPrice) return { ok: true };
  return {
    ok: false,
    reason: "core: paid endpoint needs rails, offers, or price_usd",
  };
}

/**
 * Structural inclusion gate (no payment_verified). Used BEFORE free unpaid 402 probes.
 */
export function gradeStructural(ep: EndpointRecord): GateResult {
  const summary = (ep.summary ?? "").trim();
  const path = ep.path ?? "";
  const comp = completeness(ep);

  if (META_FILE.test(path) || META_PATH.test(path))
    return { verdict: "drop", reasons: ["meta/well-known path"], flags: [], completeness: comp };
  if (PREVIEW_HOST.test(ep.origin ?? ""))
    return { verdict: "drop", reasons: ["ephemeral preview deploy"], flags: [], completeness: comp };
  if (!summary || STUB.test(summary))
    return { verdict: "drop", reasons: ["stub: synthesized summary"], flags: [], completeness: comp };
  if (isContentFree(summary) && isContentFree(ep.description))
    return { verdict: "drop", reasons: ["content-free summary (boilerplate)"], flags: [], completeness: comp };

  const doc = hasDocCore(ep);
  if (!doc.ok)
    return { verdict: "drop", reasons: [doc.reason!], flags: [], completeness: comp };

  const pay = hasPaymentCore(ep);
  if (!pay.ok)
    return { verdict: "drop", reasons: [pay.reason!], flags: [], completeness: comp };

  // Soft floor — ultra-empty shells only (after core). Completeness 4 with strong core is rare.
  if (comp < MIN_FIELDS)
    return {
      verdict: "drop",
      reasons: [`thin: only ${comp}/${FLESH_MAX} fields filled`],
      flags: [],
      completeness: comp,
    };

  return { verdict: "pass", reasons: [], flags: [], completeness: comp };
}

export function gradeEndpoint(ep: EndpointRecord): GateResult {
  const structural = gradeStructural(ep);
  if (structural.verdict === "drop") return structural;

  const comp = structural.completeness;

  if (ep.payment_verified === "contradicted")
    return {
      verdict: "drop",
      reasons: ["failed live payment verification"],
      flags: [],
      completeness: comp,
    };

  const offers = ep.payment?.offers ?? [];
  const rails = ep.payment?.rails ?? [];
  const hasPayment =
    (ep.payment?.paid ?? false) ||
    offers.length > 0 ||
    ep.payment?.price_usd != null ||
    rails.length > 0;
  const flags: string[] = [];
  if (!hasPayment) flags.push("no-payment-detected");
  else {
    if (offers.length === 0) flags.push("legacy-payment");
    if (ep.payment?.price_usd == null) flags.push("price-dynamic-or-unknown");
  }
  if (ep.schema_missing) flags.push("schema-missing");
  if (offers.length > 0 && ep.responses?.has402 === false) flags.push("no-402-declared");
  if (ep.payment_verified === "verified") flags.push("payment-verified");
  else if (ep.payment_verified === "unknown") flags.push("payment-unverified");
  if (ep.usage && ((ep.usage.transactions ?? 0) > 0 || (ep.usage.volume_usd ?? 0) > 0))
    flags.push("onchain-usage");
  if (!(ep.description ?? "").trim()) flags.push("no-description");
  if ((ep.inputs?.length ?? 0) === 0) flags.push("no-inputs");

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
  const s: GateSummary = {
    total: records.length,
    pass: 0,
    drop: 0,
    reasons: {},
    flags: {},
    avg_completeness: 0,
  };
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
