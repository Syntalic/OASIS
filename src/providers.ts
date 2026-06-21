import type { EndpointRecord, PaySkillsProvider, ProviderRecord } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9._\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  return inter / (a.size + b.size - inter);
}

function inferSource(fqn: string): ProviderRecord["sources"][number] {
  if (fqn.startsWith("mpp-catalog/")) return "mpp-catalog";
  if (fqn.startsWith("x402scan/")) return "x402scan";
  if (fqn.startsWith("mppscan/")) return "mppscan";
  return "pay-skills";
}

function railProtocols(endpoints: EndpointRecord[]): string[] {
  const rails = new Set<string>();
  for (const ep of endpoints) {
    for (const r of ep.payment.rails) rails.add(r.protocol);
  }
  return [...rails].sort();
}

function minPriceUsd(endpoints: EndpointRecord[]): number | undefined {
  const prices = endpoints
    .map((e) => e.payment.price_usd)
    .filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : undefined;
}

export function buildProviderRecords(
  endpoints: EndpointRecord[],
  paySkillsProviders: PaySkillsProvider[] = [],
): ProviderRecord[] {
  const paySkillsByFqn = new Map(paySkillsProviders.map((p) => [p.fqn, p]));
  const byFqn = new Map<string, EndpointRecord[]>();

  for (const ep of endpoints) {
    const fqn = ep.provider_fqn ?? ep.origin;
    const list = byFqn.get(fqn) ?? [];
    list.push(ep);
    byFqn.set(fqn, list);
  }

  const draft: ProviderRecord[] = [];

  for (const [fqn, eps] of byFqn) {
    const paySkills = paySkillsByFqn.get(fqn);
    const sample = eps[0];
    const origins = [...new Set(eps.map((e) => e.origin))];
    const categories = [
      ...new Set(
        [paySkills?.category, ...eps.map((e) => e.category)].filter(Boolean),
      ),
    ] as string[];
    const richDescriptions = eps
      .map((e) => e.description)
      .filter((d): d is string => Boolean(d && d.length > 24));
    const inferredDescription =
      richDescriptions[0] ??
      eps.find((e) => e.summary.length > 20 && !e.summary.startsWith("GET /"))?.summary;
    const tagSummary = [
      ...new Set(eps.flatMap((e) => e.tags ?? [])),
    ].slice(0, 8);
    const inferredUseCase =
      paySkills?.use_case ??
      (tagSummary.length
        ? `Paid API for ${tagSummary.join(", ").toLowerCase()} via ${origins[0]}`
        : inferredDescription
          ? `Use for ${inferredDescription.slice(0, 160).toLowerCase()}`
          : undefined);

    draft.push({
      fqn,
      title: paySkills?.title ?? sample.provider_title ?? fqn,
      description: paySkills?.description ?? inferredDescription,
      use_case: inferredUseCase,
      category: categories[0],
      categories,
      service_url: paySkills?.service_url ?? origins[0],
      origins,
      endpoint_count: eps.length,
      payment_rails: railProtocols(eps),
      min_price_usd: minPriceUsd(eps),
      guidance_available: eps.some((e) => e.guidance_available),
      spend_patterns: paySkills?.spend_patterns,
      capabilities: paySkills?.capabilities,
      sources: [inferSource(fqn)],
      search_text: [
        fqn,
        paySkills?.title,
        paySkills?.description,
        paySkills?.use_case,
        inferredDescription,
        inferredUseCase,
        tagSummary.join(" "),
        categories.join(" "),
        origins.join(" "),
        paySkills?.spend_patterns?.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    });
  }

  const byCategory = new Map<string, ProviderRecord[]>();
  for (const p of draft) {
    const cat = p.category ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(p);
    byCategory.set(cat, list);
  }

  for (const p of draft) {
    const cat = p.category ?? "other";
    const peers = (byCategory.get(cat) ?? []).filter((x) => x.fqn !== p.fqn);
    const selfTokens = new Set(tokenize(`${p.use_case ?? ""} ${p.description ?? ""}`));
    const ranked = peers
      .map((peer) => ({
        fqn: peer.fqn,
        score: jaccard(selfTokens, new Set(tokenize(`${peer.use_case ?? ""} ${peer.description ?? ""}`))),
      }))
      .filter((x) => x.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.fqn);
    if (ranked.length) p.alternatives = ranked;
  }

  return draft.sort((a, b) => a.fqn.localeCompare(b.fqn));
}

export function enrichEndpointsWithProviders(
  endpoints: EndpointRecord[],
  providers: ProviderRecord[],
): void {
  const byFqn = new Map(providers.map((p) => [p.fqn, p]));
  for (const ep of endpoints) {
    const fqn = ep.provider_fqn ?? ep.origin;
    const provider = byFqn.get(fqn);
    if (!provider) continue;
    ep.provider_title = ep.provider_title ?? provider.title;
    ep.category = ep.category ?? provider.category;
    const extra = [
      provider.title,
      provider.description,
      provider.use_case,
      provider.category,
      provider.spend_patterns?.join(" "),
      provider.alternatives?.map((a) => a.replace(/\//g, " ")).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    if (extra && !ep.search_text.includes(extra.toLowerCase().slice(0, 40))) {
      ep.search_text = `${ep.search_text} ${extra}`.toLowerCase().replace(/\s+/g, " ").trim();
    }
  }
}