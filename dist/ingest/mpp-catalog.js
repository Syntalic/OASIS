import { endpointId } from "../id.js";
import { canonicalOrigin } from "../origin-aliases.js";
const MPP_CATALOG_URL = "https://mpp.dev/api/services";
function parseAmountHint(hint) {
    if (!hint)
        return undefined;
    const m = hint.match(/\$([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : undefined;
}
function paymentFromMpp(payment) {
    const method = payment?.method ?? "tempo";
    const rails = method === "stripe" || method === "card"
        ? [{ protocol: "mpp", networks: [method] }]
        : [{ protocol: "mpp", networks: [method === "tempo" ? "tempo" : method] }];
    let price_usd = parseAmountHint(payment?.amountHint);
    if (price_usd == null && payment?.amount && payment.decimals != null) {
        price_usd = Number(payment.amount) / 10 ** payment.decimals;
    }
    return {
        paid: true,
        price_usd,
        rails,
    };
}
export async function ingestMppCatalog(builtAt) {
    const res = await fetch(MPP_CATALOG_URL, {
        headers: { Accept: "application/json" },
    });
    if (!res.ok) {
        throw new Error(`mpp.dev catalog fetch failed: ${res.status}`);
    }
    const catalog = (await res.json());
    const records = [];
    for (const service of catalog.services ?? []) {
        const origin = canonicalOrigin((service.serviceUrl ?? service.url ?? "").replace(/\/$/, ""));
        if (!origin.startsWith("http"))
            continue;
        const providerTitle = service.name;
        const category = service.categories?.[0];
        const searchBase = [
            service.id,
            service.name,
            service.description,
            ...(service.categories ?? []),
            ...(service.tags ?? []),
            "mpp",
            "mppscan",
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        for (const ep of service.endpoints ?? []) {
            const method = (ep.method ?? "GET").toUpperCase();
            const path = ep.path.startsWith("/") ? ep.path : `/${ep.path}`;
            const summary = ep.summary ?? ep.description ?? `${method} ${path}`;
            records.push({
                id: endpointId(origin, method, path),
                origin,
                method,
                path,
                summary,
                description: ep.description,
                provider_fqn: `mpp-catalog/${service.id}`,
                provider_title: providerTitle,
                category,
                payment: paymentFromMpp(ep.payment),
                guidance_available: true,
                openapi_url: `${origin}/openapi.json`,
                search_text: `${searchBase} ${summary} ${path}`.toLowerCase(),
                built_at: builtAt,
            });
        }
    }
    return records;
}
//# sourceMappingURL=mpp-catalog.js.map