// Single source of truth for the text an endpoint is embedded/tokenized as.
//
// The build-time endpoint-vector cache (endpoint-cache.ts) and the shipped int8 index
// (scripts/build-endpoint-index.mjs, via the cache hashes) are keyed by sha256 of
// endpointEmbedText(ep), and src/endpoint-arm.ts recomputes it at serve time to look the
// vector up. So EVERY caller must use this one function — divergence silently breaks the
// hash join (cache misses, an unreachable arm). Changing the text here invalidates the
// cache: delete dist/cache/endpoint-vecs.* then re-run `pnpm build` + `pnpm run
// build:endpoint-index`.
import type { EndpointRecord } from "../core/types.js";

/**
 * Billing/wrapper boilerplate the embedder should NOT see. For mechanics-heavy endpoints
 * (Apify actors, x402 wrappers, generic /scrape proxies) the raw summary leads with pricing
 * and call-mechanics — e.g. `Start the "Reddit Scraper Lite" Apify actor. Pay Per Result …`
 * — which drag the dense vector toward dev-tooling/billing space and below the binder's dense
 * floor for the correct intent, even when the capability terms ("reddit", "posts", "comments")
 * are right there. Stripping it lets the dense vector reflect the CAPABILITY.
 *
 * A denylist of KNOWN boilerplate (phrase/pattern level — a superset of the single-word STOP
 * set in bind-endpoints' sparse arm). Intentionally conservative: it only removes terms that
 * are never capability content, so it can never drop a real task term. Grow it from the orphan
 * audit; never invert it into an allowlist.
 */
const BOILERPLATE: RegExp[] = [
  /\$\s?\d[\d.,]*/g, // "$0.01", "$ 0.013"
  /\b\d+(?:\.\d+)?\s*usdc?\b/gi, // "0.013 USDC", "5 USD"
  /\bpay[\s-]?per[\s-]?(?:result|call|request|use)\b/gi, // billing model
  /\b(?:x402|mpp|micro[\s-]?payments?)\b/gi, // payment rails / protocols
  /\bno\s+api[\s-]?key\s+(?:required|needed)?\b/gi, // "no API key required"
  /\bwithout\s+login\b/gi, // "without login"
  /\bapify\b/gi, // wrapper/vendor brand — not a capability term
  /\b(?:start|run|invoke)\s+the\b/gi, // actor/job lead-in framing ("Start the … actor")
];

/**
 * Strip known billing/wrapper boilerplate so the embedded text reflects the CAPABILITY, not
 * how-to-call / what-it-costs. Pure and case-preserving — safe to unit-test.
 */
export function normalizeEndpointText(raw: string): string {
  let t = raw;
  for (const re of BOILERPLATE) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Endpoint text to embed/tokenize — task signal only (summary/description/path/inputs), never
 * origin/provider (which would leak vendor names into the match), with billing/wrapper
 * boilerplate stripped. See the file header on the hash contract before changing it.
 */
export function endpointEmbedText(ep: EndpointRecord): string {
  const raw = [ep.summary, ep.description, ep.path, ...(ep.inputs ?? [])]
    .filter(Boolean)
    .join(" ");
  return normalizeEndpointText(raw);
}
