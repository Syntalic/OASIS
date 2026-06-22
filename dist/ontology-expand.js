import { CURATED_INTENT_IDS } from "./intent-match.js";
import { rankEndpointsNeutral } from "./score-endpoint.js";
const CURATED_ID_SET = new Set(CURATED_INTENT_IDS);
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
    const curatedOrigins = new Set(curated.flatMap((c) => c.satisfies.map((s) => s.origin.replace(/\/$/, ""))));
    for (const provider of paySkillsProviders) {
        const id = intentIdForProvider(provider);
        if (existingIds.has(id) || CURATED_ID_SET.has(id))
            continue;
        if (curatedOrigins.has(provider.service_url.replace(/\/$/, "")))
            continue;
        const eps = byFqn.get(provider.fqn) ?? [];
        const primary = rankEndpointsNeutral(eps, 3);
        if (!primary.length)
            continue;
        const aliases = [
            ...aliasesFromText(provider.use_case, provider.description),
            provider.title,
        ].filter((a, i, arr) => arr.indexOf(a) === i);
        generated.push({
            id,
            label: provider.title,
            description: provider.description ?? provider.use_case,
            aliases,
            satisfies: primary.map((ep) => ({
                origin: ep.origin,
                method: ep.method,
                path: ep.path,
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
        if (existingIds.has(id) || CURATED_ID_SET.has(id))
            continue;
        const primary = rankEndpointsNeutral(eps, 3);
        if (!primary.length)
            continue;
        const title = eps[0]?.provider_title ?? serviceId;
        const desc = eps[0]?.description ?? `${title} via MPP micropayment`;
        generated.push({
            id,
            label: title,
            description: desc,
            aliases: aliasesFromText(desc, title, serviceId.replace(/-/g, " "), eps[0]?.category),
            satisfies: primary.map((ep) => ({
                origin: ep.origin,
                method: ep.method,
                path: ep.path,
            })),
        });
        existingIds.add(id);
    }
    return [...curated, ...generated];
}
/** @deprecated Curated intents use intent-match.ts at build time. */
const KEYWORD_INTENTS = [
    {
        id: "comms.agent_inbox",
        label: "Create an AI agent email inbox",
        aliases: ["agent inbox", "ai agent email", "agentmail inbox", "create inbox"],
        match: (ep) => /\/v0\/inboxes$/i.test(ep.path) &&
            ep.method === "POST" &&
            ep.origin.includes("agentmail"),
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
        match: (ep) => /scrape/i.test(`${ep.summary} ${ep.path}`) &&
            !/proxy|storage|interest/i.test(`${ep.summary} ${ep.path}`),
    },
    {
        id: "data.company_enrich",
        label: "Enrich company data from domain",
        aliases: ["company enrichment", "enrich company", "domain lookup company"],
        match: (ep) => /company.*enrich|enrich.*company|company-enrichment/i.test(`${ep.summary} ${ep.path} ${ep.provider_fqn ?? ""} ${ep.origin}`),
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
        match: (ep) => /perplexity|sonar|anthropic|openai|chat.?completion/i.test(`${ep.summary} ${ep.path} ${ep.provider_fqn ?? ""} ${ep.origin}`),
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
        match: (ep) => /token.?balance|wallet.?balance|holdings/i.test(`${ep.summary} ${ep.path}`) &&
            !/nft|ownerof|proxy/i.test(`${ep.summary} ${ep.path}`),
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
        match: (ep) => /tripadvisor/i.test(`${ep.origin} ${ep.provider_fqn ?? ""}`) ||
            /\/api\/v1\/location/i.test(ep.path),
    },
    {
        id: "realestate.property_lookup",
        label: "Look up property and rental data",
        aliases: ["rentcast", "property data", "rental estimate", "real estate"],
        match: (ep) => /rentcast|property|rental/i.test(`${ep.summary} ${ep.provider_fqn ?? ""}`),
    },
];
/** @deprecated Replaced by materializeCuratedIntents + intent-match.ts */
export function expandOntologyFromKeywords(intents, _endpoints) {
    return intents;
}
/** Alias/label terms an intent contributes to the substring binder. */
function intentBindingTerms(intent) {
    return [intent.label, intent.description, ...(intent.aliases ?? [])]
        .filter(Boolean)
        .map((t) => t.toLowerCase())
        .filter((t) => t.length >= 5);
}
function endpointBindingCorpus(ep) {
    return `${ep.search_text ?? ""} ${ep.summary ?? ""} ${ep.path ?? ""}`.toLowerCase();
}
/**
 * Tag previously-unbound endpoints with their best-matching curated/generated
 * intent via the alias/label substring signal.
 *
 * Determinism: the legacy implementation was *first-match-wins by intent array
 * order* — whichever intent happened to iterate first claimed a contested
 * endpoint. This version scores every candidate intent for each unbound endpoint
 * and assigns the single best one, so the result no longer depends on iteration
 * order. The eligibility rule is unchanged (an endpoint is bound iff ≥1 intent
 * term substring-hits its corpus), so the *set* of bound endpoints is identical
 * to the legacy binder — only the winner among contested matches becomes a
 * deterministic best-score pick instead of an arbitrary order-dependent one.
 *
 * Score = number of distinct matching terms; ties break toward the more specific
 * (longer total matched-term length), then curated intents over generated ones
 * (curated aliases are vetted, so this reduces mis-binds), then the
 * lexicographically smallest intent id for a fully stable, reproducible result.
 */
export function inferCapabilityLinks(intents, endpointIndex) {
    const candidates = intents.map((intent) => ({
        id: intent.id,
        curated: CURATED_ID_SET.has(intent.id),
        terms: intentBindingTerms(intent),
    }));
    let linked = 0;
    for (const [, ep] of endpointIndex) {
        if (ep.capabilities?.length)
            continue;
        const corpus = endpointBindingCorpus(ep);
        let best;
        for (const cand of candidates) {
            let matches = 0;
            let coverage = 0;
            for (const term of cand.terms) {
                if (corpus.includes(term)) {
                    matches += 1;
                    coverage += term.length;
                }
            }
            if (matches === 0)
                continue;
            if (!best ||
                matches > best.matches ||
                (matches === best.matches && coverage > best.coverage) ||
                (matches === best.matches &&
                    coverage === best.coverage &&
                    cand.curated &&
                    !best.curated) ||
                (matches === best.matches &&
                    coverage === best.coverage &&
                    cand.curated === best.curated &&
                    cand.id < best.id)) {
                best = { id: cand.id, matches, coverage, curated: cand.curated };
            }
        }
        if (!best)
            continue;
        ep.capabilities = [best.id];
        linked += 1;
    }
    return linked;
}
/**
 * Endpoints that bound to no intent (after curated satisfies + inferred links).
 * Returned for visibility / coverage reporting; does not mutate anything.
 */
export function unboundEndpoints(endpoints) {
    return [...endpoints].filter((ep) => !ep.capabilities?.length);
}
/** Count of endpoints that bound to no intent. */
export function countUnboundEndpoints(endpoints) {
    let n = 0;
    for (const ep of endpoints)
        if (!ep.capabilities?.length)
            n += 1;
    return n;
}
/**
 * OPTIONAL precision signal: does an endpoint's derived facets agree with an
 * intent's authored facets? Returns `true` when nothing contradicts (absent
 * facets never contradict, so this is permissive by design). Intended as an
 * *additional* gate on top of the existing binder — NOT a replacement — so it
 * must never widen or change the default binding set on its own.
 */
export function facetGateAgrees(intentFacets, endpointFacets) {
    if (!intentFacets || !endpointFacets)
        return true;
    if (intentFacets.domain &&
        endpointFacets.domain &&
        intentFacets.domain !== endpointFacets.domain) {
        return false;
    }
    if (intentFacets.modality?.length && endpointFacets.modality?.length) {
        const epModality = new Set(endpointFacets.modality);
        if (!intentFacets.modality.some((m) => epModality.has(m)))
            return false;
    }
    return true;
}
//# sourceMappingURL=ontology-expand.js.map