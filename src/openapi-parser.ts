import type {
  EndpointRecord,
  HttpMethod,
  PaymentInfo,
  PaymentRail,
} from "./types.js";
import { endpointId } from "./id.js";
import { canonicalOrigin } from "./origin-aliases.js";
import {
  derivePriceUsd,
  deriveRails,
  parsePaymentOffers,
  parseServiceInfo,
} from "./payment-spec.js";

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
): EndpointRecord[] {
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
        };
      } else {
        payment = { paid: false, rails: [] };
      }

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
        search_text: searchText,
        built_at: options.builtAt,
      });
    }
  }

  return records;
}