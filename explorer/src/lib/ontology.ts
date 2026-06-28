import raw from "@/data/ontology.json";

/* ------------------------------------------------------------------ */
/* Types — mirror the slim graph emitted from dist/index.json          */
/* ------------------------------------------------------------------ */

export interface Port {
  entity: string;
  role: string | null;
  format: string | null;
}

export interface SampleEndpoint {
  origin: string;
  method: string;
  path: string;
  source: string | null;
  confidence: string | null;
}

export interface Provider {
  host: string;
  n: number;
}

export interface Capability {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  domain: string;
  action: string | null;
  modality: string[];
  freshness: string | null;
  consumes: Port[];
  produces: Port[];
  endpointCount: number;
  topProviders: Provider[];
  sampleEndpoints: SampleEndpoint[];
}

export interface Domain {
  id: string;
  capabilities: string[];
  endpointCount: number;
}

export interface Entity {
  name: string;
  producedBy: string[];
  consumedBy: string[];
}

export interface Ontology {
  built_at: string;
  stats: {
    domains: number;
    capabilities: number;
    entities: number;
    boundEndpoints: number;
  };
  domains: Domain[];
  entities: Entity[];
  capabilities: Capability[];
}

export const ontology = raw as unknown as Ontology;

export const capabilities = ontology.capabilities;
export const domains = ontology.domains;
export const entities = ontology.entities;

export const capById = new Map(capabilities.map((c) => [c.id, c]));
export const entityByName = new Map(entities.map((e) => [e.name, e]));
export const domainById = new Map(domains.map((d) => [d.id, d]));

/* ------------------------------------------------------------------ */
/* Domain palette — each domain has a stable hue + human label         */
/* ------------------------------------------------------------------ */

export interface DomainMeta {
  id: string;
  label: string;
  /** vivid accent for nodes/edges */
  color: string;
  /** soft translucent fill */
  soft: string;
  blurb: string;
}

const DOMAIN_META: Record<string, Omit<DomainMeta, "id">> = {
  ai: { label: "AI", color: "#a78bfa", soft: "rgba(167,139,250,0.14)", blurb: "Generative & inference models" },
  data: { label: "Data", color: "#38bdf8", soft: "rgba(56,189,248,0.14)", blurb: "Lookups, enrichment & reference data" },
  finance: { label: "Finance", color: "#34d399", soft: "rgba(52,211,153,0.14)", blurb: "Markets, rates & money movement" },
  comms: { label: "Comms", color: "#fb7185", soft: "rgba(251,113,133,0.14)", blurb: "Email, SMS, voice & messaging" },
  shop: { label: "Shop", color: "#f59e0b", soft: "rgba(245,158,11,0.14)", blurb: "Commerce & product discovery" },
  web: { label: "Web", color: "#22d3ee", soft: "rgba(34,211,238,0.14)", blurb: "Scraping & web content" },
  maps: { label: "Maps", color: "#4ade80", soft: "rgba(74,222,128,0.14)", blurb: "Geocoding, places & routing" },
  travel: { label: "Travel", color: "#facc15", soft: "rgba(250,204,21,0.14)", blurb: "Flights, stays & itineraries" },
  realestate: { label: "Real Estate", color: "#fbbf24", soft: "rgba(251,191,36,0.14)", blurb: "Property data" },
  social: { label: "Social", color: "#f472b6", soft: "rgba(244,114,182,0.14)", blurb: "Social platform data" },
  media: { label: "Media", color: "#c084fc", soft: "rgba(192,132,252,0.14)", blurb: "Audio, video & image media" },
  marketing: { label: "Marketing", color: "#fb923c", soft: "rgba(251,146,60,0.14)", blurb: "Growth & outreach tooling" },
  analyst: { label: "Analyst", color: "#2dd4bf", soft: "rgba(45,212,191,0.14)", blurb: "Indicators & analysis" },
  cloud: { label: "Cloud", color: "#60a5fa", soft: "rgba(96,165,250,0.14)", blurb: "Infrastructure & provisioning" },
  compute: { label: "Compute", color: "#818cf8", soft: "rgba(129,140,248,0.14)", blurb: "Calculation & conversion" },
  devtools: { label: "Dev Tools", color: "#94a3b8", soft: "rgba(148,163,184,0.14)", blurb: "Developer utilities" },
  storage: { label: "Storage", color: "#5eead4", soft: "rgba(94,234,212,0.14)", blurb: "File & object storage" },
  search: { label: "Search", color: "#fcd34d", soft: "rgba(252,211,77,0.14)", blurb: "Search & retrieval" },
  crypto: { label: "Crypto", color: "#a3e635", soft: "rgba(163,230,53,0.14)", blurb: "On-chain & web3 data" },
  agent: { label: "Agent", color: "#e879f9", soft: "rgba(232,121,249,0.14)", blurb: "Agent memory & marketplaces" },
  other: { label: "Other", color: "#9ca3af", soft: "rgba(156,163,184,0.14)", blurb: "Uncategorized" },
};

export function domainMeta(id: string): DomainMeta {
  const m = DOMAIN_META[id] ?? DOMAIN_META.other;
  return { id, ...m };
}

export const ENTITY_COLOR = "#e2e8f0";

/* ------------------------------------------------------------------ */
/* Question matching — lightweight, fully client-side scorer           */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  "a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "is",
  "are", "i", "want", "need", "how", "do", "can", "me", "my", "find", "get",
  "api", "apis", "that", "this", "from", "into", "give", "show", "please",
  "use", "using", "service", "which", "what", "some", "any", "be", "it",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface MatchResult {
  capability: Capability;
  score: number;
  /** 0..1 normalized against the top hit */
  strength: number;
  hits: string[];
}

/**
 * Score every capability against a natural-language question using token
 * overlap across label / aliases / description / facets / entities. No network,
 * no API key — this is a transparent local approximation of the OASIS binder so
 * the visualization can react instantly as the user types.
 */
export function matchCapabilities(query: string, limit = 7): MatchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: MatchResult[] = [];

  for (const cap of capabilities) {
    const label = cap.label.toLowerCase();
    const aliasText = cap.aliases.join(" ").toLowerCase();
    const desc = cap.description.toLowerCase();
    const facetText = [cap.domain, cap.action, ...cap.modality, cap.freshness ?? ""]
      .join(" ")
      .toLowerCase();
    const entityText = [...cap.consumes, ...cap.produces]
      .map((p) => p.entity)
      .join(" ")
      .toLowerCase();

    let score = 0;
    const hits = new Set<string>();

    for (const t of tokens) {
      let matched = false;
      if (label.includes(t)) { score += 5; matched = true; }
      if (aliasText.includes(t)) { score += 4; matched = true; }
      if (entityText.includes(t)) { score += 3; matched = true; }
      if (facetText.includes(t)) { score += 2.5; matched = true; }
      if (desc.includes(t)) { score += 1.5; matched = true; }
      // whole-token equality on the id segments
      if (cap.id.split(/[._-]/).includes(t)) { score += 3; matched = true; }
      if (matched) hits.add(t);
    }

    // coverage bonus: reward matching more of the question
    if (hits.size > 0) score += (hits.size / tokens.length) * 2;
    // mild popularity prior so ties favor well-served capabilities
    if (score > 0) score += Math.min(cap.endpointCount, 50) / 200;

    if (score > 0) {
      results.push({ capability: cap, score, strength: 0, hits: [...hits] });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, limit);
  const max = top.length ? top[0].score : 1;
  for (const r of top) r.strength = r.score / max;
  return top;
}

/** Curated example questions surfaced as quick-start chips. */
export const SAMPLE_QUESTIONS = [
  "Turn an article into narrated audio",
  "Convert 100 USD to euros in real time",
  "Find a paid API to screenshot a webpage",
  "Enrich a company from its domain name",
  "Generate an image from a text prompt",
  "Send a transactional SMS to a customer",
  "Get a 7-day weather forecast for a city",
  "Extract structured data from a PDF invoice",
];
