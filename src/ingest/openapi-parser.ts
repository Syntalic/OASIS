import type {
  DeclaredPayTo,
  EndpointRecord,
  HttpMethod,
  PaymentInfo,
  PaymentRail,
} from "../core/types.js";
import { endpointId } from "../core/id.js";
import { canonicalOrigin } from "./origin-aliases.js";
import {
  derivePriceUsd,
  deriveRails,
  parsePaymentOffers,
  parseServiceInfo,
} from "./payment-spec.js";
import { SchemaCollector } from "./schema-store.js";
import { openApiEndpointSchemas } from "./endpoint-schemas.js";

/** Known non-merchant contracts / network ids that appear as eth/sol strings in specs. */
const NON_MERCHANT_ADDR = new Set(
  [
    // Base USDC (Circle)
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    // Tempo USDC-style currency often stuffed into mpp.currency
    "0x20c000000000000000000000b9537d11c60e8b50",
    // Null merchant (bogus / placeholder)
    "0x0000000000000000000000000000000000000000",
    // Solana mainnet genesis hash (shows up as "network" not wallet)
    "5eykt4usfv8p8njdtrepy1vzqkqzkvdp",
  ].map((s) => s.toLowerCase()),
);

const ETH_ADDR = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function looksLikeMerchantWallet(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (ETH_ADDR.test(t)) return !NON_MERCHANT_ADDR.has(t.toLowerCase());
  if (t.startsWith("0x")) return false;
  if (SOL_ADDR.test(t) && !NON_MERCHANT_ADDR.has(t.toLowerCase())) {
    // UUIDs / pure hex blobs are not sol wallets
    if (/^[a-f0-9-]{32,}$/i.test(t)) return false;
    return true;
  }
  return false;
}

/**
 * Harvest merchant wallets from OpenAPI extensions that authors use instead of
 * (or in addition to) a live 402 challenge:
 *   • x-faremeter-assets.*.recipient
 *   • x-payment-info.payTo / pay_to / recipient
 *   • x-payment-info.protocols[].x402.payTo / mpp.recipient
 *   • op["x-402"].networks[].payTo | pay_to
 *   • info.x-402 / info.x-payment / x-payment-accepts
 * Token/currency fields are skipped so USDC contracts are not treated as merchants.
 */
export function extractDeclaredPayTos(
  doc: OpenApiDoc,
  op: Record<string, unknown>,
): DeclaredPayTo[] {
  const out = new Map<string, DeclaredPayTo>();

  const add = (raw: unknown, source: string, network?: string, asset?: string) => {
    if (typeof raw !== "string") return;
    if (!looksLikeMerchantWallet(raw)) return;
    const payTo = raw.trim();
    const key = payTo.toLowerCase();
    if (out.has(key)) return;
    out.set(key, {
      payTo,
      network,
      asset,
      source,
    });
  };

  // Doc-level faremeter asset registry (Syntalic-style)
  const assets = doc["x-faremeter-assets"] ?? {};
  for (const [assetId, meta] of Object.entries(assets)) {
    if (!meta || typeof meta !== "object") continue;
    const m = meta as Record<string, unknown>;
    add(m.recipient, `x-faremeter-assets.${assetId}.recipient`, typeof m.chain === "string" ? m.chain : undefined, assetId);
    // some specs use payTo on the asset
    add(m.payTo ?? m.pay_to, `x-faremeter-assets.${assetId}.payTo`, typeof m.chain === "string" ? m.chain : undefined, assetId);
  }

  // Doc-level info extensions
  const info = doc.info as Record<string, unknown> | undefined;
  if (info) {
    const x402 = info["x-402"] as Record<string, unknown> | undefined;
    if (x402) {
      add(x402.pay_to ?? x402.payTo ?? x402.recipient, "info.x-402.pay_to");
      const nets = x402.networks as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(nets)) {
        for (const n of nets) {
          add(n.pay_to ?? n.payTo ?? n.recipient, "info.x-402.networks.pay_to", typeof n.network === "string" ? n.network : undefined);
        }
      }
    }
    const xp = info["x-payment"] as Record<string, unknown> | undefined;
    if (xp) add(xp.pay_to ?? xp.payTo ?? xp.recipient, "info.x-payment.pay_to");
  }

  // Root accepts lists
  const accepts = (doc as Record<string, unknown>)["x-payment-accepts"] as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(accepts)) {
    for (const a of accepts) {
      add(a.payTo ?? a.pay_to ?? a.recipient, "x-payment-accepts.payTo", typeof a.network === "string" ? a.network : undefined);
    }
  }

  // Operation-level
  const paymentInfo = op["x-payment-info"] as Record<string, unknown> | undefined;
  if (paymentInfo) {
    add(paymentInfo.payTo ?? paymentInfo.pay_to ?? paymentInfo.recipient, "x-payment-info.payTo");
    const protocols = paymentInfo.protocols as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(protocols)) {
      for (const p of protocols) {
        if (!p || typeof p !== "object") continue;
        const x402 = p.x402 as Record<string, unknown> | undefined;
        if (x402 && typeof x402 === "object") {
          add(x402.payTo ?? x402.pay_to ?? x402.recipient, "x-payment-info.protocols.x402.payTo");
        }
        const mpp = p.mpp as Record<string, unknown> | undefined;
        if (mpp && typeof mpp === "object") {
          // recipient is merchant; currency is token — only take recipient
          add(mpp.recipient ?? mpp.payTo ?? mpp.pay_to, "x-payment-info.protocols.mpp.recipient");
        }
      }
    }
    const methods = paymentInfo.methods as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(methods)) {
      for (const m of methods) {
        add(m.payTo ?? m.pay_to ?? m.recipient, "x-payment-info.methods.payTo");
      }
    }
  }

  // Telemost-style x-402 on the operation
  const opX402 = op["x-402"] as Record<string, unknown> | undefined;
  if (opX402) {
    add(opX402.payTo ?? opX402.pay_to ?? opX402.recipient, "x-402.payTo");
    const nets = opX402.networks as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(nets)) {
      for (const n of nets) {
        add(n.payTo ?? n.pay_to ?? n.recipient, "x-402.networks.payTo", typeof n.network === "string" ? n.network : undefined);
      }
    }
  }

  const opXp = op["x-payment"] as Record<string, unknown> | undefined;
  if (opXp) add(opXp.pay_to ?? opXp.payTo ?? opXp.recipient, "x-payment.pay_to");

  return [...out.values()];
}

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

interface OpenApiDoc {
  openapi?: string;
  servers?: Array<{ url: string }>;
  info?: {
    title?: string;
    description?: string;
    "x-guidance"?: string;
    "x-agent-guidance"?: string;
    guidance?: string;
  };
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
  "x-faremeter-assets"?: Record<string, { chain?: string }>;
  "x-service-info"?: unknown;
}

function normalizeOrigin(url: string): string {
  return url.replace(/\/$/, "");
}

function extractNetworks(doc: OpenApiDoc, op: Record<string, unknown>): string[] {
  const networks = new Set<string>();
  const assets = doc["x-faremeter-assets"] ?? {};
  for (const chain of Object.values(assets).map((a) => a.chain).filter(Boolean)) {
    networks.add(chain as string);
  }
  const paymentInfo = op["x-payment-info"] as Record<string, unknown> | undefined;
  const protocols = paymentInfo?.protocols as Array<Record<string, unknown>> | undefined;
  if (protocols) {
    for (const p of protocols) {
      if (p.x402) networks.add("x402");
      if (p.mpp || p.tempo) networks.add("tempo");
    }
  }
  const methods = paymentInfo?.methods as Array<Record<string, unknown>> | undefined;
  if (methods?.some((m) => m.method === "tempo")) {
    networks.add("tempo");
  }
  return [...networks];
}

function extractRails(doc: OpenApiDoc, op: Record<string, unknown>): PaymentRail[] {
  const rails: PaymentRail[] = [];
  const networks = extractNetworks(doc, op);
  const paymentInfo = op["x-payment-info"] as Record<string, unknown> | undefined;
  const protocols = paymentInfo?.protocols as Array<Record<string, unknown>> | undefined;
  const offers = paymentInfo?.offers as Array<Record<string, unknown>> | undefined;

  let hasX402 = false;
  let hasMpp = false;

  if (protocols) {
    for (const p of protocols) {
      if (typeof p === "string" && p === "x402") hasX402 = true;
      if (p.x402) hasX402 = true;
      if (p.mpp || p.tempo) hasMpp = true;
    }
  }

  if (offers) {
    for (const offer of offers) {
      const method = String(offer.method ?? "");
      if (method === "x402" || method === "evm") hasX402 = true;
      if (["tempo", "mpp", "stripe", "card", "lightning", "solana"].includes(method)) {
        hasMpp = true;
      }
    }
  }

  const methods = paymentInfo?.methods as Array<Record<string, unknown>> | undefined;
  if (methods?.some((m) => m.method === "tempo")) hasMpp = true;

  const assets = doc["x-faremeter-assets"] ?? {};
  if (Object.keys(assets).length > 0) hasX402 = true;
  if (Object.values(assets).some((a) => a.chain === "tempo")) hasMpp = true;

  if (paymentInfo?.method === "tempo" || paymentInfo?.method === "stripe") hasMpp = true;

  if (hasX402) {
    rails.push({
      protocol: "x402",
      version: "2",
      networks: networks.filter((n) => n !== "tempo"),
    });
  }
  if (hasMpp) {
    rails.push({
      protocol: "mpp",
      networks: networks.includes("tempo") ? ["tempo"] : undefined,
    });
  }

  if (rails.length === 0 && paymentInfo) {
    rails.push({ protocol: "x402", version: "2" });
  }

  return rails.length > 0 ? rails : [{ protocol: "x402", version: "2" }];
}

function extractPriceUsd(op: Record<string, unknown>): number | undefined {
  const paymentInfo = op["x-payment-info"] as Record<string, unknown> | undefined;
  const offers = paymentInfo?.offers as Array<Record<string, unknown>> | undefined;
  if (offers?.[0]?.amount != null) {
    const raw = Number(offers[0].amount);
    if (!Number.isNaN(raw)) {
      const decimals = Number(offers[0].decimals ?? 6);
      return raw / 10 ** decimals;
    }
  }
  const price = paymentInfo?.price as Record<string, unknown> | undefined;
  if (price?.amount != null) {
    const n = Number(price.amount);
    if (!Number.isNaN(n)) return n;
  }
  // Dynamic / range range (stableupload-style): use min as a ranking floor when present.
  // Full amount stays unknown; completeness/currency still benefit via extractPaymentCurrency.
  if (price?.min != null) {
    const n = Number(price.min);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  if (paymentInfo?.amount != null) {
    const raw = Number(paymentInfo.amount);
    if (!Number.isNaN(raw) && raw > 100) return raw / 1_000_000;
  }
  const faremeter = op["x-faremeter-pricing"] as Record<string, unknown> | undefined;
  const rates = faremeter?.rates as Record<string, string> | undefined;
  if (rates) {
    const first = Object.values(rates)[0];
    if (first) {
      const raw = Number(first);
      if (!Number.isNaN(raw)) return raw / 1_000_000;
    }
  }
  const pricing = op.pricing as Record<string, unknown> | undefined;
  const dimensions = pricing?.dimensions as Array<Record<string, unknown>> | undefined;
  if (dimensions?.[0]) {
    const tiers = dimensions[0].tiers as Array<Record<string, unknown>> | undefined;
    if (tiers?.[0]?.price_usd != null) {
      return Number(tiers[0].price_usd);
    }
  }
  return undefined;
}

/** Currency token/code from x-payment-info (including dynamic price.currency = "USD"). */
function extractPaymentCurrency(op: Record<string, unknown>): string | undefined {
  const paymentInfo = op["x-payment-info"] as Record<string, unknown> | undefined;
  if (!paymentInfo) return undefined;
  const offers = paymentInfo.offers as Array<Record<string, unknown>> | undefined;
  if (typeof offers?.[0]?.currency === "string") return offers[0].currency;
  const price = paymentInfo.price as Record<string, unknown> | undefined;
  if (typeof price?.currency === "string") return price.currency;
  if (typeof paymentInfo.currency === "string") return paymentInfo.currency;
  return undefined;
}

function isPaid(op: Record<string, unknown>): boolean {
  return Boolean(
    op["x-payment-info"] ||
      op["x-faremeter-pricing"] ||
      op.pricing,
  );
}

/** Resolve a local `#/components/...` JSON pointer; foreign/remote refs → undefined. */
function resolveRef(
  doc: OpenApiDoc,
  ref: string,
): Record<string, unknown> | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[decodeURIComponent(part)];
    } else return undefined;
  }
  return cur && typeof cur === "object"
    ? (cur as Record<string, unknown>)
    : undefined;
}

/** Property names of a schema, resolving $ref and merging allOf/oneOf/anyOf/items. */
function schemaPropertyNames(
  doc: OpenApiDoc,
  schema: Record<string, unknown> | undefined,
  depth = 0,
): string[] {
  if (!schema || depth > 6) return [];
  if (typeof schema.$ref === "string") {
    return schemaPropertyNames(doc, resolveRef(doc, schema.$ref), depth + 1);
  }
  const out = new Set<string>();
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props) for (const key of Object.keys(props)) out.add(key);
  for (const comb of ["allOf", "oneOf", "anyOf"] as const) {
    const arr = schema[comb] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(arr)) {
      for (const sub of arr) {
        for (const n of schemaPropertyNames(doc, sub, depth + 1)) out.add(n);
      }
    }
  }
  const items = schema.items as Record<string, unknown> | undefined;
  if (items) for (const n of schemaPropertyNames(doc, items, depth + 1)) out.add(n);
  return [...out];
}

/**
 * Endpoint input parameter names, for the resolve-relevance signal. Covers
 * query/path/header `parameters` AND requestBody properties across every content
 * type (json, multipart/form-data, x-www-form-urlencoded), resolving local
 * `$ref` schemas and merging allOf/oneOf — POST bodies are frequently a `$ref`
 * to a component, which the previous json-properties-only scan dropped entirely.
 */
function extractInputs(op: Record<string, unknown>, doc: OpenApiDoc): string[] {
  const inputs = new Set<string>();

  const params = op.parameters as Array<Record<string, unknown>> | undefined;
  if (params) {
    for (const raw of params) {
      const p =
        typeof raw.$ref === "string" ? (resolveRef(doc, raw.$ref) ?? raw) : raw;
      if (typeof p.name === "string") inputs.add(p.name);
    }
  }

  let body = op.requestBody as Record<string, unknown> | undefined;
  if (body && typeof body.$ref === "string") body = resolveRef(doc, body.$ref);
  const content = body?.content as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (content) {
    for (const media of Object.values(content)) {
      const schema = media?.schema as Record<string, unknown> | undefined;
      for (const name of schemaPropertyNames(doc, schema)) inputs.add(name);
    }
  }

  return [...inputs];
}

function buildSearchText(parts: Array<string | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOpenApi(
  doc: OpenApiDoc,
  options: {
    origin?: string;
    builtAt: string;
    capabilityIds?: string[];
  },
): { records: EndpointRecord[]; schemas: SchemaCollector } {
  const origin = canonicalOrigin(
    normalizeOrigin(
      options.origin ??
        doc.servers?.[0]?.url ??
        "https://unknown.invalid",
    ),
  );
  const guidance =
    doc.info?.["x-agent-guidance"] ??
    doc.info?.["x-guidance"] ??
    doc.info?.guidance;
  const guidanceAvailable = Boolean(guidance);
  const service = parseServiceInfo(doc["x-service-info"]);
  const openapiUrl = `${origin}/openapi.json`;
  const records: EndpointRecord[] = [];
  const schemas = new SchemaCollector();

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const op = operation as Record<string, unknown>;
      const httpMethod = method.toUpperCase() as HttpMethod;
      const summary =
        (op.summary as string) ||
        (op.description as string)?.slice(0, 120) ||
        `${httpMethod} ${path}`;
      // Canonical x-payment-info per draft-payment-discovery-00 (validated offers);
      // fall back to legacy faremeter/pricing extraction for non-spec specs.
      const { offers } = parsePaymentOffers(op["x-payment-info"]);
      const paid = offers.length > 0 || isPaid(op);
      const declared_pay_tos = extractDeclaredPayTos(doc, op);
      let payment: PaymentInfo;
      if (offers.length > 0) {
        const { price, currency } = derivePriceUsd(offers);
        const railsFromOffers = deriveRails(offers);
        payment = {
          price_usd: price ?? extractPriceUsd(op),
          paid: true,
          rails: railsFromOffers.length ? railsFromOffers : extractRails(doc, op),
          offers,
          currency,
        };
      } else if (paid) {
        payment = {
          price_usd: extractPriceUsd(op),
          paid: true,
          rails: extractRails(doc, op),
          currency: extractPaymentCurrency(op),
        };
      } else {
        payment = { paid: false, rails: [] };
      }
      if (declared_pay_tos.length) payment.declared_pay_tos = declared_pay_tos;

      const responsesObj = op.responses as Record<string, unknown> | undefined;
      const responses = {
        has200: Boolean(responsesObj?.["200"]),
        has402: Boolean(responsesObj?.["402"]),
      };
      const writeMethod =
        httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH";
      const schemaMissing = paid && writeMethod && !op.requestBody;

      const tags = op.tags as string[] | undefined;
      const searchText = buildSearchText([
        doc.info?.title,
        doc.info?.description,
        summary,
        op.description as string,
        path,
        tags?.join(" "),
        options.capabilityIds?.join(" "),
        guidance?.slice(0, 500),
      ]);

      const oas30 = (doc.openapi ?? "3.0").startsWith("3.0");
      const io = openApiEndpointSchemas(op, (ref) => resolveRef(doc, ref), oas30);
      const input_schema_ref = io.input ? schemas.add(io.input) : undefined;
      const output_schema_ref = io.output ? schemas.add(io.output) : undefined;

      records.push({
        id: endpointId(origin, httpMethod, path),
        origin,
        method: httpMethod,
        path,
        operation_id: op.operationId as string | undefined,
        summary,
        description: op.description as string | undefined,
        tags,
        capabilities: options.capabilityIds,
        inputs: extractInputs(op, doc),
        payment,
        service,
        responses,
        schema_missing: schemaMissing,
        guidance_available: guidanceAvailable,
        openapi_url: openapiUrl,
        input_schema_ref,
        output_schema_ref,
        schema_source: input_schema_ref || output_schema_ref ? "openapi" : undefined,
        schema_captured_at: input_schema_ref || output_schema_ref ? options.builtAt : undefined,
        schema_truncated: io.truncated || undefined,
        search_text: searchText,
        built_at: options.builtAt,
      });
    }
  }

  return { records, schemas };
}