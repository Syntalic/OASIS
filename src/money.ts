// Amount normalization across ingestion-source formats. Payment amounts arrive as:
//   • base-unit integer strings  — x-payment-info offers, Bazaar `accepts` (amount + asset)
//   • human hints                — mpp.dev `amountHint` ("$0.20/page")
//   • explicit decimals          — mpp.dev payment.decimals
//   • already-USD floats         — pay.sh min_price_usd / max_price_usd
// These helpers convert any of them to a USD number (or undefined for dynamic pricing).

/** Known token contract addresses → decimals (lowercased). USDC is 6. Unknown tokens
 *  default to 6 (the USDC convention); extend as new assets appear. */
const TOKEN_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6, // USDC (Base)
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC (Ethereum)
  "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": 6, // USDC (Polygon)
};
const DEFAULT_TOKEN_DECIMALS = 6;
const FIAT = /^[a-z]{3}$/i;

function isTokenAddress(s: string | undefined): boolean {
  return !!s && /^0x[0-9a-f]{40}$/i.test(s);
}

/** Pull a USD figure from a human hint like "$0.20/page" or "approx $1.50". */
export function parseAmountHint(hint: string | undefined | null): number | undefined {
  if (!hint) return undefined;
  const m = hint.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : undefined;
}

/** Resolve decimals from (in priority order) an explicit value, a token asset/currency
 *  address, or a fiat ISO code; falls back to the USDC default. */
export function decimalsFor(opts: { decimals?: number; asset?: string; currency?: string }): number {
  if (typeof opts.decimals === "number" && Number.isFinite(opts.decimals)) return opts.decimals;
  const token = opts.asset ?? (isTokenAddress(opts.currency) ? opts.currency : undefined);
  if (token) return TOKEN_DECIMALS[token.toLowerCase()] ?? DEFAULT_TOKEN_DECIMALS;
  if (opts.currency && FIAT.test(opts.currency)) return 2; // fiat smallest unit = cents
  return DEFAULT_TOKEN_DECIMALS;
}

/** Convert a base-unit integer-string amount to USD. null / non-integer → undefined (dynamic). */
export function baseUnitsToUsd(
  amount: string | number | null | undefined,
  opts: { decimals?: number; asset?: string; currency?: string } = {},
): number | undefined {
  if (amount == null) return undefined;
  const str = String(amount);
  if (!/^\d+$/.test(str)) return undefined;
  const n = Number(str);
  if (!Number.isFinite(n)) return undefined;
  return n / 10 ** decimalsFor(opts);
}
