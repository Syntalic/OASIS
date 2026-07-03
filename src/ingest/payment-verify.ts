/**
 * payment-verify.ts — pure probe-response classifier.
 *
 * No I/O: `validateOutput` is injected by the caller (Task 6).
 * Drop only on an affirmative lie (strict 4-leg 2xx discriminator).
 * A 402 is never contradicted.
 */

import type { LiveChallenge, LiveAccept } from '../core/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Verdict = 'verified' | 'contradicted' | 'unknown';

export interface VerifyResult {
  verdict: Verdict;
  reason: string;
  challenge?: LiveChallenge[];
}

export interface ProbeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  probedMethod: string;
}

export interface ProbeContext {
  declaredMethod: string;
  rails: ('x402' | 'mpp')[];
  priceDynamic: boolean;
  /** Injected schema validator — returns true if the body matches the endpoint's output schema. */
  validateOutput?: (body: unknown) => boolean;
}

type NetworkErrorInput = { networkError: true; reason?: string };

// ---------------------------------------------------------------------------
// classifyProbe
// ---------------------------------------------------------------------------

export function classifyProbe(
  r: ProbeResponse | NetworkErrorInput,
  ctx: ProbeContext,
): VerifyResult {
  // Network error / timeout
  if ('networkError' in r) {
    return { verdict: 'unknown', reason: r.reason ?? 'network_error' };
  }

  const { status, body, headers, probedMethod } = r;

  // ------------------------------------------------------------------
  // 402 — try x402 then MPP; never contradicted
  // ------------------------------------------------------------------
  if (status === 402) {
    // ---- x402 ----
    const x402Result = tryX402(body);
    if (x402Result) return x402Result;

    // ---- MPP ----
    const wwwAuthKey = Object.keys(headers).find((k) => k.toLowerCase() === 'www-authenticate');
    const wwwAuth = wwwAuthKey ? headers[wwwAuthKey] : undefined;
    if (wwwAuth) {
      const mppResult = tryMpp(wwwAuth);
      if (mppResult) return mppResult;
    }

    // Neither parseable → unknown; reason based on declared rails
    const onlyMpp =
      ctx.rails.length > 0 && ctx.rails.every((r) => r === 'mpp');
    return {
      verdict: 'unknown',
      reason: onlyMpp ? 'mpp_no_header' : 'x402_malformed',
    };
  }

  // ------------------------------------------------------------------
  // 2xx — contradicted ONLY if all 4 legs pass; else unknown
  // ------------------------------------------------------------------
  if (status >= 200 && status < 300) {
    return classify2xx(body, probedMethod, ctx);
  }

  // ------------------------------------------------------------------
  // Any other status (3xx/4xx/5xx)
  // ------------------------------------------------------------------
  return { verdict: 'unknown', reason: `http_${status}` };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Try to parse an x402-style body. Returns VerifyResult on success, null to fall through. */
function tryX402(body: string): VerifyResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const accepts = obj['accepts'];
  if (!Array.isArray(accepts)) return null;

  const valid: LiveAccept[] = [];
  for (const entry of accepts) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const hasScheme = typeof e['scheme'] === 'string';
    const hasNetworkOrAsset =
      typeof e['network'] === 'string' || typeof e['asset'] === 'string';
    const hasPayTo = typeof e['payTo'] === 'string';
    const hasAmount =
      typeof e['amount'] === 'string' || typeof e['maxAmountRequired'] === 'string';

    if (hasScheme && hasNetworkOrAsset && hasPayTo && hasAmount) {
      valid.push({
        scheme: e['scheme'] as string,
        network: e['network'] as string | undefined,
        asset: e['asset'] as string | undefined,
        payTo: e['payTo'] as string,
        amount: e['amount'] as string | undefined,
        maxAmountRequired: e['maxAmountRequired'] as string | undefined,
      });
    }
  }

  if (valid.length === 0) return null;

  const challenge: LiveChallenge = { protocol: 'x402', accepts: valid };
  return { verdict: 'verified', reason: 'x402_challenge', challenge: [challenge] };
}

/**
 * Parse a WWW-Authenticate header whose first scheme token is "Payment" (case-insensitive).
 * Uses a bounded key="value" tokeniser (NOT a greedy regex) — max 4096-char header, max 64 params.
 */
function tryMpp(header: string): VerifyResult | null {
  // Bound to prevent pathological input
  const bounded = header.slice(0, 4096);

  // Extract the first whitespace-delimited token as the scheme name
  const schemeMatch = /^(\S+)/.exec(bounded);
  if (!schemeMatch) return null;
  const schemeName = schemeMatch[1];
  if (schemeName.toLowerCase() !== 'payment') return null;

  const rest = bounded.slice(schemeName.length);

  // Parse individual key="value" params (non-greedy; value may not contain ")
  const params: Record<string, string> = {};
  const tokenRe = /(\w+)="([^"]{0,512})"/g;
  let m: RegExpExecArray | null;
  let iterations = 0;
  while ((m = tokenRe.exec(rest)) !== null && iterations < 64) {
    params[m[1].toLowerCase()] = m[2];
    iterations++;
  }

  const challenge: LiveChallenge = {
    protocol: 'mpp',
    www_authenticate: bounded,
  };
  if (params['realm']) challenge.realm = params['realm'];
  if (params['method']) challenge.method = params['method'];
  if (params['intent']) challenge.intent = params['intent'];

  return { verdict: 'verified', reason: 'mpp_challenge', challenge: [challenge] };
}

/**
 * 2xx discriminator — strict 4-leg check:
 * (a) method matches, (b) not a structured error, (c) not price-dynamic, (d) schema validates.
 * Any leg failing → unknown.
 */
function classify2xx(
  body: string,
  probedMethod: string,
  ctx: ProbeContext,
): VerifyResult {
  const AMBIGUOUS: VerifyResult = { verdict: 'unknown', reason: 'served_2xx_ambiguous' };

  // Leg (a): method must match
  if (probedMethod !== ctx.declaredMethod) return AMBIGUOUS;

  // Leg (c): price must not be dynamic
  if (ctx.priceDynamic) return AMBIGUOUS;

  // Leg (d): validateOutput must be provided (schema-less → inconclusive)
  if (!ctx.validateOutput) return AMBIGUOUS;

  // Parse body for legs (b) and (d) — non-JSON can never be an affirmative lie
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return AMBIGUOUS;
  }

  // Leg (b): must not be a structured error
  if (isStructuredError(parsed, body)) return AMBIGUOUS;

  // Leg (d): schema must validate; guard against hostile validators throwing
  let validates: boolean;
  try {
    validates = ctx.validateOutput(parsed);
  } catch {
    validates = false;
  }
  if (!validates) return AMBIGUOUS;

  // All 4 legs pass — affirmative lie
  return { verdict: 'contradicted', reason: 'served_2xx_verified_content' };
}

// ---------------------------------------------------------------------------
// applyCircuitBreaker
// ---------------------------------------------------------------------------

/**
 * Catalog-delta circuit-breaker for mass-drop protection.
 *
 * Counts ids whose verdict is `contradicted` AND were present in `priorIds`
 * (newly-dropped from the catalog). Trips if:
 *   - `priorClaimedPaid > 0` (first crawl never trips), AND
 *   - `newlyDropped / priorClaimedPaid > maxFraction` (default 0.15), OR
 *   - `newlyDropped > maxAbs` (default 500).
 *
 * Pure — does not mutate `verdicts`. The caller downgrades verdicts on trip.
 */
export function applyCircuitBreaker(
  verdicts: Map<string, Verdict>,
  priorIds: Set<string>,
  priorClaimedPaid: number,
  opts: { maxFraction?: number; maxAbs?: number } = {},
): { tripped: boolean; newlyDropped: number } {
  const maxFraction = opts.maxFraction ?? 0.15;
  const maxAbs = opts.maxAbs ?? 500;
  let newlyDropped = 0;
  for (const [id, v] of verdicts) if (v === 'contradicted' && priorIds.has(id)) newlyDropped++;
  const tripped =
    priorClaimedPaid > 0 &&
    (newlyDropped / priorClaimedPaid > maxFraction || newlyDropped > maxAbs);
  return { tripped, newlyDropped };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the parsed body (or raw text) looks like a payment/error response rather
 * than actual paid content. Conservative: only exclude clear error indicators.
 */
function isStructuredError(parsed: unknown, raw: string): boolean {
  // Text-level check: payment-gate prose
  if (/payment required|unauthorized/i.test(raw)) return true;

  if (parsed !== null && parsed !== undefined && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['error', 'message', 'code', 'detail', 'x402Version']) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) return true;
    }
  }

  return false;
}
