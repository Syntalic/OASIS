// Spec-compliant parsing of the OpenAPI payment extensions defined by
// draft-payment-discovery-00 (Tempo Labs + Merit Systems): x-payment-info (Appendix C)
// and x-service-info (Appendix D). Raw extension blobs are validated against the
// authoritative JSON Schemas in spec/ before we trust them, then normalized.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PaymentOffer, PaymentRail, ServiceInfo } from "../core/types.js";
import { baseUnitsToUsd } from "../core/money.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (
  ajv: InstanceType<typeof Ajv>,
) => InstanceType<typeof Ajv>;

const SPEC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "spec");
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
addFormats(ajv);
const validatePaymentInfo = ajv.compile(
  JSON.parse(readFileSync(path.join(SPEC_DIR, "x-payment-info.schema.json"), "utf8")),
);
const validateServiceInfo = ajv.compile(
  JSON.parse(readFileSync(path.join(SPEC_DIR, "x-service-info.schema.json"), "utf8")),
);

/**
 * Normalize x-payment-info (single-offer shorthand OR `{offers:[]}`) into an offer[],
 * but only if it conforms to the Appendix C schema. `valid` is false when the extension
 * is absent or malformed (so the caller can keep legacy fallbacks / mark schema issues).
 */
export function parsePaymentOffers(raw: unknown): { offers: PaymentOffer[]; valid: boolean } {
  if (raw == null || typeof raw !== "object") return { offers: [], valid: false };
  if (!validatePaymentInfo(raw)) return { offers: [], valid: false };
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.offers) ? obj.offers : [obj];
  const offers = list.map((o) => {
    const x = o as Record<string, unknown>;
    return {
      intent: x.intent as "charge" | "session",
      method: String(x.method),
      amount: (x.amount as string | null) ?? null,
      currency: x.currency as string | undefined,
      description: x.description as string | undefined,
    } satisfies PaymentOffer;
  });
  return { offers, valid: true };
}

/** Parse + validate a root x-service-info extension (Appendix D). */
export function parseServiceInfo(raw: unknown): ServiceInfo | undefined {
  if (raw == null || typeof raw !== "object") return undefined;
  if (!validateServiceInfo(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const service: ServiceInfo = {};
  if (Array.isArray(obj.categories)) {
    service.categories = obj.categories.filter((c): c is string => typeof c === "string");
  }
  const docs = obj.docs as Record<string, unknown> | undefined;
  if (docs) {
    const d: ServiceInfo["docs"] = {};
    if (typeof docs.apiReference === "string") d.apiReference = docs.apiReference;
    if (typeof docs.homepage === "string") d.homepage = docs.homepage;
    if (typeof docs.llms === "string") d.llms = docs.llms;
    if (Object.keys(d).length) service.docs = d;
  }
  return Object.keys(service).length ? service : undefined;
}

/**
 * Convert one offer's base-unit `amount` to USD via the shared money helpers (asset-decimal
 * aware: a USDC token address resolves to 6, a fiat ISO code to cents). Dynamic (null) or
 * non-integer amounts → undefined.
 */
export function offerToUsd(offer: PaymentOffer): number | undefined {
  return baseUnitsToUsd(offer.amount, { currency: offer.currency });
}

/** Cheapest convertible offer → { price_usd, currency }. */
export function derivePriceUsd(offers: PaymentOffer[]): { price?: number; currency?: string } {
  let best: { price: number; currency?: string } | undefined;
  for (const o of offers) {
    const usd = offerToUsd(o);
    if (usd == null) continue;
    if (!best || usd < best.price) best = { price: usd, currency: o.currency };
  }
  return best ? { price: best.price, currency: best.currency } : {};
}

/** Map offer payment methods to OASIS rails. x402/evm → x402; everything else (tempo,
 *  stripe, card, lightning, solana, …) → the MPP family. */
export function deriveRails(offers: PaymentOffer[]): PaymentRail[] {
  let x402 = false;
  let mpp = false;
  for (const o of offers) {
    const m = o.method.toLowerCase();
    if (m === "x402" || m === "evm") x402 = true;
    else mpp = true;
  }
  const rails: PaymentRail[] = [];
  if (x402) rails.push({ protocol: "x402", version: "2" });
  if (mpp) rails.push({ protocol: "mpp" });
  return rails;
}
