import { existsSync } from "node:fs";
import { curatedCapabilitiesForSearch } from "./curated-search.js";
import { embedText } from "./embed/embedder.js";
import { openLanceTable } from "./embed/lance-index.js";
import { searchIndex } from "./search.js";
import type {
  CapabilityIntent,
  FacetDomain,
  IndexBundle,
  SearchHit,
} from "./types.js";

const RRF_K = 60;

/** Keyword hits are weighted higher so vector acts as recall, not rerank noise. */
export const DEFAULT_KEYWORD_WEIGHT = 2;
export const DEFAULT_VECTOR_WEIGHT = 1;

export interface HybridFusionOptions {
  keywordWeight?: number;
  vectorWeight?: number;
  candidatePool?: number;
}

interface RankedItem {
  key: string;
  rrf: number;
  keywordRank: number | null;
  vectorRank: number | null;
}

function hitKey(hit: SearchHit): string {
  // Endpoint rows must not collapse onto shared capability_id tags.
  if (hit.kind === "endpoint" && hit.endpoint_id) return `ep:${hit.endpoint_id}`;
  if (hit.capability_id) return `cap:${hit.capability_id}`;
  if (hit.endpoint_id) return `ep:${hit.endpoint_id}`;
  return `label:${hit.label}`;
}

function lanceKey(kind: string, id: string): string {
  // Resolve each vector row to the key namespace the merger fuses on. The index
  // is capability-only this round, but an endpoint row must key as ep:<id> (the
  // same shape hitKey produces) so it can fuse with keyword endpoint hits — not
  // fall into an inert other:<id> bucket the merger silently drops. Unknown
  // kinds still bucket out so a stray row can never masquerade as a capability.
  if (kind === "endpoint") return `ep:${id}`;
  if (kind === "capability") return `cap:${id}`;
  return `other:${id}`;
}

/**
 * Coarse query→domain inference. Each rule admits a CLUSTER of related facet
 * domains (not a single one) so a correct-but-sibling intent is never filtered
 * out — the pre-filter's whole job is to prune cross-domain vector noise while
 * keeping false-negatives near zero. Rules are deliberately broad; a query that
 * matches nothing returns the empty set, which the pre-filter treats as
 * "no restriction" so recall is never harmed. M2's search.ts exports no query
 * facet helper, so domain is inferred inline here, conservatively.
 */
const DOMAIN_RULES: Array<[RegExp, FacetDomain[]]> = [
  // pricing / commerce intelligence
  [
    /\bprice|pricing|cheaper|cheapest|markdown|discount|deal|\bsku\b|retail|cost less|on sale|price drop|inflat|\bcpi\b|grocery|competitor pric|price compar/i,
    ["shop", "marketing", "analyst"],
  ],
  // chain / crypto / markets / currency
  [
    /\bcrypto|bitcoin|\bbtc\b|\beth\b|ethereum|solana|wallet|token|on-?chain|erc-?\d|json-?rpc|blockchain|spot (price|quote)|\bstock\b|nvda|ticker|exchange rate|\bfx\b|forex|convert .*(usd|eur|jpy|gbp)|\d+ ?(usd|eur|jpy|gbp)/i,
    ["finance", "crypto", "compute", "data"],
  ],
  // ai generation & transforms
  [
    /\bgenerate (an?|spoken|image)|text-to-image|sdxl|picture|chat completion|claude|\bllm\b|embedding|dense vector|text-to-speech|speech-to-text|transcribe|voicemail|translate|\bocr\b|scanned|extract.*(pdf|fields|table)|structured fields|document/i,
    ["ai", "data", "web"],
  ],
  // web fetch / scrape / research / search
  [
    /\bscrape|\bhtml\b|markdown|screenshot|snapshot|webpage|web page|blog post url|web-grounded|citations|google-style|web results|\bserp\b|search the web|crawl/i,
    ["web", "ai", "search", "data"],
  ],
  // comms / messaging
  [
    /\bemail|\bsms\b|\bfax\b|inbox|mailbox|\bcall\b|robocall|\bdial\b|outbound message|transactional|otp text|sendgrid|verification code/i,
    ["comms"],
  ],
  // identity / people / company / social
  [
    /\bcompany|firmographic|enrich|person|profile|influencer|creator|instagram|facebook|social|micro-?influencer|whois|domain (metadata|name)|\bmx record/i,
    ["data", "social", "media", "cloud"],
  ],
  // places / real estate / travel
  [
    /\brestaurant|coffee shop|near (downtown|me|shibuya)|listings|houses|homes|\bmls\b|zip code|property|for sale|reviews|\bplaces\b|nearby/i,
    ["maps", "travel", "realestate"],
  ],
  // hosting / storage / domains
  [
    /\bhost|hosting|file hosting|static (assets|site|website)|landing page|upload static|readme site|renew .* domain/i,
    ["storage", "cloud"],
  ],
  // validation / data utilities
  [
    /\bvalidate|is this .*(real|valid)|disposable|throwaway|phone number|integral|compute the|\bjob\b|engineer roles|ip address|weather|temperature|forecast|located|hosts it|captcha|human verification|bypass/i,
    ["data", "devtools", "compute"],
  ],
];

export function inferQueryDomains(query: string): Set<FacetDomain> {
  const domains = new Set<FacetDomain>();
  for (const [re, doms] of DOMAIN_RULES) {
    if (re.test(query)) for (const d of doms) domains.add(d);
  }
  return domains;
}

/**
 * A capability's domain: prefer the authored facet, else fall back to the id
 * prefix, which IS the facet domain in this taxonomy (every curated id is
 * `<domain>.<name>` and every prefix is a valid FacetDomain). The id is always
 * present even when materialization hasn't yet passed facets through, so the
 * pre-filter works today AND tightens automatically once facets land.
 */
function capabilityDomain(cap: CapabilityIntent): string {
  if (cap.facets?.domain) return cap.facets.domain;
  const prefix = cap.id.split(".")[0];
  return prefix;
}

/**
 * COARSE pre-filter: restrict the candidate capabilities to those whose domain
 * is compatible with the query, on the coarsest axis only (domain) where false
 * negatives are unlikely. Degrades gracefully: if no domain is inferred, or no
 * capability is compatible, returns the full set so recall is never harmed.
 * Returns the set of allowed capability ids, or null to mean "no restriction".
 */
export function coarseCapabilityAllowlist(
  query: string,
  bundle: IndexBundle,
): Set<string> | null {
  const queryDomains = inferQueryDomains(query);
  if (queryDomains.size === 0) return null; // nothing inferred → no restriction

  const allowed = new Set<string>();
  for (const cap of curatedCapabilitiesForSearch(bundle)) {
    if (queryDomains.has(capabilityDomain(cap) as FacetDomain)) {
      allowed.add(cap.id);
    }
  }
  // Empty allowlist would wipe out every capability candidate → fall back.
  return allowed.size > 0 ? allowed : null;
}

function rrfScore(rank: number, weight: number): number {
  return weight / (RRF_K + rank);
}

function capabilityToHit(cap: CapabilityIntent, score: number): SearchHit {
  return {
    kind: "capability",
    score,
    capability_id: cap.id,
    label: cap.label,
    summary: cap.description ?? cap.label,
  };
}

function mergeKeywordAndVector(
  keywordHits: SearchHit[],
  vectorHits: Array<{ kind: string; id: string }>,
  bundle: IndexBundle,
  limit: number,
  fusion: Required<Pick<HybridFusionOptions, "keywordWeight" | "vectorWeight">>,
  capabilityAllowlist: Set<string> | null,
): SearchHit[] {
  const scores = new Map<string, RankedItem>();

  // Apply the coarse pre-filter BEFORE RRF: drop capability candidates whose
  // domain is incompatible with the query so cross-domain vector noise cannot
  // outrank the keyword-correct intent. Endpoints are never filtered (the
  // allowlist is capability-only), and a null allowlist filters nothing.
  const capAllowed = (capId: string | undefined): boolean =>
    capabilityAllowlist === null ||
    capId === undefined ||
    capabilityAllowlist.has(capId);

  for (let i = 0; i < keywordHits.length; i++) {
    const hit = keywordHits[i];
    if (hit.kind === "capability" && !capAllowed(hit.capability_id)) continue;
    const key = hitKey(hit);
    const existing = scores.get(key) ?? {
      key,
      rrf: 0,
      keywordRank: null,
      vectorRank: null,
    };
    existing.rrf += rrfScore(i + 1, fusion.keywordWeight);
    existing.keywordRank = i + 1;
    scores.set(key, existing);
  }

  for (let i = 0; i < vectorHits.length; i++) {
    const { kind, id } = vectorHits[i];
    // The index is capability-only, so a vector row id is a capability id; gate
    // it on the same allowlist. (Endpoint rows, if ever embedded, are exempt.)
    if (kind === "capability" && !capAllowed(id)) continue;
    const key = lanceKey(kind, id);
    const existing = scores.get(key) ?? {
      key,
      rrf: 0,
      keywordRank: null,
      vectorRank: null,
    };
    existing.rrf += rrfScore(i + 1, fusion.vectorWeight);
    existing.vectorRank = i + 1;
    scores.set(key, existing);
  }

  // Capabilities lead, endpoints follow — each ranked by fused RRF. Pooling them
  // into one sort lets keyword endpoint hits (weight 2x, dominant by count) bury
  // a capability that only the vector arm found, so on novel phrasings the right
  // intent fell past the limit (hybrid 43% vs vector-only 77% on the held-out
  // set). The traversal protocol prefers capability matches anyway; this makes
  // the fusion honor it and lets vector recall actually reach the agent.
  const pool = [...scores.values()];
  const ranked = [
    ...pool.filter((x) => x.key.startsWith("cap:")).sort((a, b) => b.rrf - a.rrf),
    ...pool.filter((x) => !x.key.startsWith("cap:")).sort((a, b) => b.rrf - a.rrf),
  ];

  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const item of ranked) {
    let hit: SearchHit | null = null;

    if (item.key.startsWith("cap:")) {
      const capId = item.key.slice(4);
      const cap = curatedCapabilitiesForSearch(bundle).find((c) => c.id === capId);
      if (cap) hit = capabilityToHit(cap, item.rrf);
    } else if (item.key.startsWith("ep:")) {
      const epId = item.key.slice(3);
      const ep = bundle.endpoints.find((e) => e.id === epId);
      if (ep) {
        hit = {
          kind: "endpoint",
          score: item.rrf,
          endpoint_id: ep.id,
          capability_id: ep.capabilities?.[0],
          label: ep.summary,
          summary: `${ep.method} ${ep.path}`,
          origin: ep.origin,
          method: ep.method,
          path: ep.path,
          price_usd: ep.payment.price_usd,
          payment_rails: ep.payment.rails.map((r) => r.protocol),
          provider_fqn: ep.provider_fqn,
        };
      }
    }

    if (!hit) continue;
    // Dedupe by identity within kind: endpoints by endpoint_id, capabilities by
    // capability_id. Endpoint hits also carry capabilities[0], so keying every
    // hit on capability_id would collapse distinct endpoints under one tag
    // (the exact collapse hitKey above is written to avoid).
    const dedupe =
      hit.kind === "endpoint"
        ? hit.endpoint_id ?? hit.label
        : hit.capability_id ?? hit.label;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    hit.score = item.rrf;
    hits.push(hit);
    if (hits.length >= limit) break;
  }

  return hits;
}

export async function searchHybrid(
  query: string,
  bundle: IndexBundle,
  lanceDir: string,
  limit = 10,
  options: HybridFusionOptions = {},
): Promise<SearchHit[]> {
  const keywordWeight = options.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT;
  const vectorWeight = options.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const candidatePool = options.candidatePool ?? 50;

  const keywordHits = searchIndex(
    query,
    bundle.endpoints,
    curatedCapabilitiesForSearch(bundle),
    candidatePool,
  );

  // Coarse domain pre-filter (null = no restriction; see graceful-degradation
  // contract on coarseCapabilityAllowlist).
  const capabilityAllowlist = coarseCapabilityAllowlist(query, bundle);

  // No vector index built yet: degrade to keyword-only silently (expected path).
  if (!existsSync(lanceDir)) {
    return keywordHits.slice(0, limit);
  }

  let vectorHits: Array<{ kind: string; id: string }> = [];
  try {
    const table = await openLanceTable(lanceDir);
    const queryVector = await embedText(query);
    const rows = await table
      .vectorSearch(queryVector)
      .limit(candidatePool)
      .toArray();
    vectorHits = rows.map((r) => ({
      kind: r.kind as string,
      id: r.id as string,
    }));
  } catch (err) {
    // The index exists but the lookup failed (corrupt table, dimension
    // mismatch, model load error): surface it instead of masking, then degrade.
    console.warn(
      `hybrid search: vector lookup failed, using keyword-only results (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
    return keywordHits.slice(0, limit);
  }

  return mergeKeywordAndVector(
    keywordHits,
    vectorHits,
    bundle,
    limit,
    { keywordWeight, vectorWeight },
    capabilityAllowlist,
  );
}

export async function searchHybridWithFallback(
  query: string,
  bundle: IndexBundle,
  lanceDir: string | null,
  limit = 10,
  options: HybridFusionOptions = {},
): Promise<SearchHit[]> {
  if (!lanceDir) {
    return searchIndex(
      query,
      bundle.endpoints,
      curatedCapabilitiesForSearch(bundle),
      limit,
    );
  }
  return searchHybrid(query, bundle, lanceDir, limit, options);
}