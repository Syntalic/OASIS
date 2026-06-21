function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
}
function aliasesFromText(...parts) {
    const text = parts.filter(Boolean).join(" ").toLowerCase();
    const phrases = new Set();
    for (const chunk of text.split(/[.,;]/)) {
        const trimmed = chunk.trim();
        if (trimmed.length >= 4 && trimmed.length <= 80)
            phrases.add(trimmed);
    }
    const words = text.split(/\s+/).filter((w) => w.length > 3);
    for (let i = 0; i < words.length - 1; i++) {
        phrases.add(`${words[i]} ${words[i + 1]}`);
    }
    return [...phrases].slice(0, 12);
}
function endpointRichness(ep) {
    let score = 0;
    if (ep.description)
        score += 3;
    if (ep.inputs?.length)
        score += ep.inputs.length;
    if (ep.payment.price_usd != null)
        score += 2;
    if (ep.payment.paid)
        score += 1;
    score -= ep.path.split("/").filter(Boolean).length * 0.2;
    return score;
}
function pickPrimaryEndpoints(endpoints, max = 3) {
    const paid = endpoints.filter((e) => e.payment.paid || e.payment.rails.length);
    const pool = paid.length ? paid : endpoints;
    return [...pool]
        .sort((a, b) => endpointRichness(b) - endpointRichness(a))
        .slice(0, max);
}
function intentIdForProvider(provider) {
    const cat = slugify(provider.category || "other");
    const name = slugify(provider.name || provider.fqn.split("/").pop() || "service");
    return `${cat}.${name}`;
}
function intentIdForMpp(serviceId, category) {
    const cat = slugify(category || "data");
    const name = slugify(serviceId);
    return `${cat}.${name}`;
}
export function expandOntologyFromProviders(curated, paySkillsProviders, endpoints) {
    const existingIds = new Set(curated.map((c) => c.id));
    const byFqn = new Map();
    for (const ep of endpoints) {
        if (!ep.provider_fqn)
            continue;
        const list = byFqn.get(ep.provider_fqn) ?? [];
        list.push(ep);
        byFqn.set(ep.provider_fqn, list);
    }
    const generated = [];
    for (const provider of paySkillsProviders) {
        const id = intentIdForProvider(provider);
        if (existingIds.has(id))
            continue;
        const eps = byFqn.get(provider.fqn) ?? [];
        const primary = pickPrimaryEndpoints(eps);
        if (!primary.length)
            continue;
        generated.push({
            id,
            label: provider.title,
            description: provider.description ?? provider.use_case,
            aliases: aliasesFromText(provider.title, provider.use_case, provider.description),
            satisfies: primary.map((ep, i) => ({
                origin: ep.origin,
                method: ep.method,
                path: ep.path,
                confidence: i === 0 ? "primary" : "secondary",
            })),
        });
        existingIds.add(id);
    }
    const mppByService = new Map();
    for (const ep of endpoints) {
        if (!ep.provider_fqn?.startsWith("mpp-catalog/"))
            continue;
        const serviceId = ep.provider_fqn.replace("mpp-catalog/", "");
        const list = mppByService.get(serviceId) ?? [];
        list.push(ep);
        mppByService.set(serviceId, list);
    }
    for (const [serviceId, eps] of mppByService) {
        const id = intentIdForMpp(serviceId, eps[0]?.category);
        if (existingIds.has(id))
            continue;
        const primary = pickPrimaryEndpoints(eps);
        if (!primary.length)
            continue;
        const title = eps[0]?.provider_title ?? serviceId;
        generated.push({
            id,
            label: title,
            description: eps[0]?.description ?? `${title} via MPP micropayment`,
            aliases: aliasesFromText(title, serviceId, eps[0]?.category, eps[0]?.description),
            satisfies: primary.map((ep, i) => ({
                origin: ep.origin,
                method: ep.method,
                path: ep.path,
                confidence: i === 0 ? "primary" : "secondary",
            })),
        });
        existingIds.add(id);
    }
    return [...curated, ...generated];
}
const KEYWORD_INTENTS = [
    {
        id: "comms.agent_inbox",
        label: "Create an AI agent email inbox",
        aliases: ["agent inbox", "ai agent email", "agentmail inbox", "create inbox"],
        match: (ep) => /inbox/i.test(ep.path) &&
            (ep.origin.includes("agentmail") || /inbox/i.test(ep.summary)),
    },
    {
        id: "comms.send_fax",
        label: "Send a fax via micropayment",
        aliases: ["send fax", "fax per page", "agent fax"],
        match: (ep) => /fax/i.test(ep.path) || /fax/i.test(ep.summary),
    },
    {
        id: "data.web_scrape",
        label: "Scrape or fetch a web page",
        aliases: ["scrape", "web scrape", "fetch page", "crawl url"],
        match: (ep) => /scrape|crawl|fetch.*page/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "data.company_enrich",
        label: "Enrich company data from domain",
        aliases: ["company enrichment", "enrich company", "domain lookup company"],
        match: (ep) => /enrich|company.*lookup/i.test(`${ep.summary} ${ep.path} ${ep.description ?? ""}`),
    },
    {
        id: "ai.image_generate",
        label: "Generate an image with AI",
        aliases: ["image generation", "generate image", "text to image", "ai image"],
        match: (ep) => /image|diffusion|dall|flux|fal/i.test(`${ep.summary} ${ep.path}`) &&
            /generat|create|render/i.test(`${ep.summary} ${ep.description ?? ""}`),
    },
    {
        id: "ai.llm_complete",
        label: "LLM text completion or chat",
        aliases: ["llm", "chat completion", "gpt", "claude", "perplexity"],
        match: (ep) => /chat|completion|llm|perplexity|anthropic|openai/i.test(`${ep.summary} ${ep.path} ${ep.provider_title ?? ""}`),
    },
    {
        id: "ai.speech_to_text",
        label: "Transcribe audio to text",
        aliases: ["speech to text", "transcribe", "stt", "whisper"],
        match: (ep) => /transcri|speech|whisper|stt/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "ai.text_to_speech",
        label: "Convert text to speech audio",
        aliases: ["text to speech", "tts", "voice synthesis"],
        match: (ep) => /texttospeech|text-to-speech|\/tts/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "data.ocr",
        label: "Extract text from images (OCR)",
        aliases: ["ocr", "optical character recognition", "read text from image"],
        match: (ep) => /ocr|optical/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "finance.token_balance",
        label: "Look up wallet token balances",
        aliases: ["token balance", "wallet balance", "holdings"],
        match: (ep) => /balance|holdings/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "social.influencer_search",
        label: "Find social media influencers",
        aliases: ["influencer", "creator search", "instagram influencer"],
        match: (ep) => /influencer|creator/i.test(`${ep.summary} ${ep.provider_title ?? ""} ${ep.path}`),
    },
    {
        id: "web.screenshot",
        label: "Capture a website screenshot",
        aliases: ["screenshot", "page capture", "website snapshot"],
        match: (ep) => /screenshot/i.test(`${ep.summary} ${ep.path} ${ep.provider_fqn ?? ""}`),
    },
    {
        id: "compute.captcha_solve",
        label: "Solve a CAPTCHA challenge",
        aliases: ["captcha", "2captcha", "solve captcha"],
        match: (ep) => /captcha/i.test(`${ep.summary} ${ep.path} ${ep.provider_fqn ?? ""}`),
    },
    {
        id: "travel.place_reviews",
        label: "Look up travel reviews and places",
        aliases: ["tripadvisor", "travel reviews", "place reviews"],
        match: (ep) => /tripadvisor|travel|review/i.test(`${ep.summary} ${ep.provider_fqn ?? ""}`),
    },
    {
        id: "realestate.property_lookup",
        label: "Look up property and rental data",
        aliases: ["rentcast", "property data", "rental estimate", "real estate"],
        match: (ep) => /rentcast|property|rental/i.test(`${ep.summary} ${ep.provider_fqn ?? ""}`),
    },
];
export function expandOntologyFromKeywords(intents, endpoints) {
    const existingIds = new Set(intents.map((i) => i.id));
    const generated = [];
    for (const template of KEYWORD_INTENTS) {
        if (existingIds.has(template.id))
            continue;
        const matches = endpoints.filter(template.match);
        const primary = pickPrimaryEndpoints(matches);
        if (!primary.length)
            continue;
        generated.push({
            id: template.id,
            label: template.label,
            aliases: template.aliases,
            satisfies: primary.map((ep, i) => ({
                origin: ep.origin,
                method: ep.method,
                path: ep.path,
                confidence: i === 0 ? "primary" : "secondary",
            })),
        });
        existingIds.add(template.id);
    }
    return [...intents, ...generated];
}
export function inferCapabilityLinks(intents, endpointIndex) {
    let linked = 0;
    for (const intent of intents) {
        const terms = [
            intent.label,
            intent.description,
            ...(intent.aliases ?? []),
        ]
            .filter(Boolean)
            .map((t) => t.toLowerCase())
            .filter((t) => t.length >= 5);
        for (const [, ep] of endpointIndex) {
            if (ep.capabilities?.length)
                continue;
            const corpus = `${ep.search_text ?? ""} ${ep.summary ?? ""} ${ep.path ?? ""}`.toLowerCase();
            const hit = terms.some((term) => corpus.includes(term));
            if (!hit)
                continue;
            ep.capabilities = [intent.id];
            linked += 1;
        }
    }
    return linked;
}
//# sourceMappingURL=ontology-expand.js.map