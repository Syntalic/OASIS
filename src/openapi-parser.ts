import type {
  EndpointRecord,
  HttpMethod,
  PaySkillsProvider,
  PaymentInfo,
  PaymentRail,
} from "./types.js";
import { endpointId } from "./id.js";

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
  "x-faremeter-assets"?: Record<string, { chain?: string }>;
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

  let hasX402 = false;
  let hasMpp = false;

  if (protocols) {
    for (const p of protocols) {
      if (p.x402) hasX402 = true;
      if (p.mpp || p.tempo) hasMpp = true;
    }
  }

  const methods = paymentInfo?.methods as Array<Record<string, unknown>> | undefined;
  if (methods?.some((m) => m.method === "tempo")) hasMpp = true;

  const assets = doc["x-faremeter-assets"] ?? {};
  if (Object.keys(assets).length > 0) hasX402 = true;
  if (Object.values(assets).some((a) => a.chain === "tempo")) hasMpp = true;

  if (paymentInfo?.method === "tempo") hasMpp = true;

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

function extractInputs(op: Record<string, unknown>): string[] {
  const inputs = new Set<string>();
  const params = op.parameters as Array<Record<string, unknown>> | undefined;
  if (params) {
    for (const p of params) {
      if (typeof p.name === "string") inputs.add(p.name);
    }
  }
  const body = op.requestBody as Record<string, unknown> | undefined;
  const content = body?.content as Record<string, Record<string, unknown>> | undefined;
  const jsonSchema = content?.["application/json"]?.schema as Record<string, unknown> | undefined;
  const props = jsonSchema?.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const key of Object.keys(props)) inputs.add(key);
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
    provider?: PaySkillsProvider;
    builtAt: string;
    capabilityIds?: string[];
  },
): EndpointRecord[] {
  const origin = normalizeOrigin(
    options.origin ??
      doc.servers?.[0]?.url ??
      options.provider?.service_url ??
      "https://unknown.invalid",
  );
  const guidance =
    doc.info?.["x-agent-guidance"] ??
    doc.info?.["x-guidance"] ??
    doc.info?.guidance;
  const guidanceAvailable = Boolean(guidance);
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
      const paid = isPaid(op);
      const payment: PaymentInfo = {
        price_usd: extractPriceUsd(op),
        paid,
        rails: paid ? extractRails(doc, op) : [{ protocol: "x402" }],
      };
      if (!paid) {
        payment.rails = [];
      }

      const tags = op.tags as string[] | undefined;
      const provider = options.provider;
      const searchText = buildSearchText([
        provider?.title,
        provider?.description,
        provider?.use_case,
        provider?.category,
        provider?.fqn,
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
        provider_fqn: provider?.fqn,
        provider_title: provider?.title,
        category: provider?.category,
        capabilities: options.capabilityIds,
        inputs: extractInputs(op),
        payment,
        guidance_available: guidanceAvailable,
        openapi_url: openapiUrl,
        search_text: searchText,
        built_at: options.builtAt,
      });
    }
  }

  return records;
}