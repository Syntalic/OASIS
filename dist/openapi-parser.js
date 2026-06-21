import { endpointId } from "./id.js";
import { canonicalOrigin } from "./origin-aliases.js";
const HTTP_METHODS = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
    "options",
]);
function normalizeOrigin(url) {
    return url.replace(/\/$/, "");
}
function extractNetworks(doc, op) {
    const networks = new Set();
    const assets = doc["x-faremeter-assets"] ?? {};
    for (const chain of Object.values(assets).map((a) => a.chain).filter(Boolean)) {
        networks.add(chain);
    }
    const paymentInfo = op["x-payment-info"];
    const protocols = paymentInfo?.protocols;
    if (protocols) {
        for (const p of protocols) {
            if (p.x402)
                networks.add("x402");
            if (p.mpp || p.tempo)
                networks.add("tempo");
        }
    }
    const methods = paymentInfo?.methods;
    if (methods?.some((m) => m.method === "tempo")) {
        networks.add("tempo");
    }
    return [...networks];
}
function extractRails(doc, op) {
    const rails = [];
    const networks = extractNetworks(doc, op);
    const paymentInfo = op["x-payment-info"];
    const protocols = paymentInfo?.protocols;
    const offers = paymentInfo?.offers;
    let hasX402 = false;
    let hasMpp = false;
    if (protocols) {
        for (const p of protocols) {
            if (typeof p === "string" && p === "x402")
                hasX402 = true;
            if (p.x402)
                hasX402 = true;
            if (p.mpp || p.tempo)
                hasMpp = true;
        }
    }
    if (offers) {
        for (const offer of offers) {
            const method = String(offer.method ?? "");
            if (method === "x402" || method === "evm")
                hasX402 = true;
            if (["tempo", "mpp", "stripe", "card", "lightning", "solana"].includes(method)) {
                hasMpp = true;
            }
        }
    }
    const methods = paymentInfo?.methods;
    if (methods?.some((m) => m.method === "tempo"))
        hasMpp = true;
    const assets = doc["x-faremeter-assets"] ?? {};
    if (Object.keys(assets).length > 0)
        hasX402 = true;
    if (Object.values(assets).some((a) => a.chain === "tempo"))
        hasMpp = true;
    if (paymentInfo?.method === "tempo" || paymentInfo?.method === "stripe")
        hasMpp = true;
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
function extractPriceUsd(op) {
    const paymentInfo = op["x-payment-info"];
    const offers = paymentInfo?.offers;
    if (offers?.[0]?.amount != null) {
        const raw = Number(offers[0].amount);
        if (!Number.isNaN(raw)) {
            const decimals = Number(offers[0].decimals ?? 6);
            return raw / 10 ** decimals;
        }
    }
    const price = paymentInfo?.price;
    if (price?.amount != null) {
        const n = Number(price.amount);
        if (!Number.isNaN(n))
            return n;
    }
    if (paymentInfo?.amount != null) {
        const raw = Number(paymentInfo.amount);
        if (!Number.isNaN(raw) && raw > 100)
            return raw / 1_000_000;
    }
    const faremeter = op["x-faremeter-pricing"];
    const rates = faremeter?.rates;
    if (rates) {
        const first = Object.values(rates)[0];
        if (first) {
            const raw = Number(first);
            if (!Number.isNaN(raw))
                return raw / 1_000_000;
        }
    }
    const pricing = op.pricing;
    const dimensions = pricing?.dimensions;
    if (dimensions?.[0]) {
        const tiers = dimensions[0].tiers;
        if (tiers?.[0]?.price_usd != null) {
            return Number(tiers[0].price_usd);
        }
    }
    return undefined;
}
function isPaid(op) {
    return Boolean(op["x-payment-info"] ||
        op["x-faremeter-pricing"] ||
        op.pricing);
}
function extractInputs(op) {
    const inputs = new Set();
    const params = op.parameters;
    if (params) {
        for (const p of params) {
            if (typeof p.name === "string")
                inputs.add(p.name);
        }
    }
    const body = op.requestBody;
    const content = body?.content;
    const jsonSchema = content?.["application/json"]?.schema;
    const props = jsonSchema?.properties;
    if (props) {
        for (const key of Object.keys(props))
            inputs.add(key);
    }
    return [...inputs];
}
function buildSearchText(parts) {
    return parts
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
export function parseOpenApi(doc, options) {
    const origin = canonicalOrigin(normalizeOrigin(options.origin ??
        doc.servers?.[0]?.url ??
        options.provider?.service_url ??
        "https://unknown.invalid"));
    const guidance = doc.info?.["x-agent-guidance"] ??
        doc.info?.["x-guidance"] ??
        doc.info?.guidance;
    const guidanceAvailable = Boolean(guidance);
    const openapiUrl = `${origin}/openapi.json`;
    const records = [];
    for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
        if (!pathItem || typeof pathItem !== "object")
            continue;
        for (const [method, operation] of Object.entries(pathItem)) {
            if (!HTTP_METHODS.has(method))
                continue;
            const op = operation;
            const httpMethod = method.toUpperCase();
            const summary = op.summary ||
                op.description?.slice(0, 120) ||
                `${httpMethod} ${path}`;
            const paid = isPaid(op);
            const payment = {
                price_usd: extractPriceUsd(op),
                paid,
                rails: paid ? extractRails(doc, op) : [{ protocol: "x402" }],
            };
            if (!paid) {
                payment.rails = [];
            }
            const tags = op.tags;
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
                op.description,
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
                operation_id: op.operationId,
                summary,
                description: op.description,
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
//# sourceMappingURL=openapi-parser.js.map