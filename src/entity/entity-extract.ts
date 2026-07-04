import nlp from "compromise";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";
import { V1_BRIDGE_IDENTITIES } from "./entity-match.js";

export interface HeldEntity {
  entity: string;
  value?: string;
  source?: string;
  role?: "identifier" | "payload";
  kind?: "identity" | "observation";
}

export interface ExtractionResult {
  entities: HeldEntity[];
  method: "explicit" | "heuristic" | "llm" | "intent_produces";
  confidence: "high" | "medium" | "low";
}

const PLACE_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/;
const DOMAIN_RE = /\b([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/i;

// Supplemental Place detection — compromise.js NER misses many international / lesser-known cities
// (Fukuoka, Ljubljana, Cluj, Da Nang) and cities that LEAD a sentence ("Hobart wineries…"). Two
// cheap, high-precision signals: (1) a capitalized token right after a locative preposition, and
// (2) a scan against a world-city gazetteer. Cross-cutting: this Place signal drives discover's
// next_steps AND the workflow hybrid matcher, so improving it lifts both.
import { WORLD_CITIES } from "./world-cities.js";

const PLACE_STOP = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "the", "a", "an", "my", "our", "this", "that", "their", "there", "here", "today", "tomorrow", "tonight", "town", "city",
  "english", "spanish", "french", "german", "chinese", "japanese", "italian", "american", "european", "general",
]);
const PREP_PLACE = /\b(?:in|near|around|throughout|across|to)\s+([A-Z][a-zà-ÿ'’.-]+(?:\s+[A-Z][a-zà-ÿ'’.-]+){0,2})/g;
const LOCATIVE = new Set(["in", "near", "around", "at", "to", "from", "across", "throughout"]);
const foldPlace = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// Notable world cities (lowercased; ambiguous common-word names like Nice/Bath/Split omitted to
// avoid false positives — those still resolve via the preposition pattern).
const CITY_GAZ = new Set(
  ("new york,los angeles,chicago,houston,phoenix,philadelphia,san antonio,san diego,dallas,san jose,san francisco,seattle,denver,boston,portland,nashville,memphis,atlanta,miami,minneapolis,cleveland,pittsburgh,cincinnati,kansas city,sacramento,austin,boise,providence,chattanooga,ann arbor,asheville,savannah,charleston,boulder,brooklyn,manhattan,detroit,fredericton,"
  + "toronto,montreal,vancouver,calgary,ottawa,mexico city,guadalajara,monterrey,oaxaca,merida,mérida,tijuana,cancun,"
  + "london,paris,madrid,barcelona,rome,milan,naples,berlin,munich,hamburg,frankfurt,cologne,amsterdam,rotterdam,brussels,ghent,antwerp,bruges,vienna,zurich,geneva,lisbon,porto,dublin,edinburgh,glasgow,manchester,birmingham,liverpool,prague,budapest,warsaw,krakow,kraków,wroclaw,wrocław,gdansk,vilnius,riga,tallinn,kaunas,helsinki,stockholm,gothenburg,oslo,bergen,copenhagen,reykjavik,reykjavík,athens,thessaloniki,istanbul,ankara,kyiv,tbilisi,yerevan,ljubljana,zagreb,belgrade,sofia,bucharest,cluj,cluj-napoca,sarajevo,valencia,seville,malaga,bilbao,lyon,marseille,bordeaux,toulouse,florence,venice,bologna,turin,palermo,tromso,tromsø,"
  + "tokyo,osaka,kyoto,yokohama,nagoya,fukuoka,sapporo,seoul,busan,beijing,shanghai,guangzhou,shenzhen,chengdu,hong kong,taipei,bangkok,chiang mai,phuket,hanoi,ho chi minh,da nang,singapore,kuala lumpur,jakarta,bali,manila,cebu,mumbai,delhi,bangalore,bengaluru,chennai,kolkata,hyderabad,pune,dubai,abu dhabi,doha,riyadh,jeddah,tel aviv,jerusalem,amman,beirut,"
  + "sydney,melbourne,brisbane,perth,adelaide,canberra,hobart,gold coast,auckland,wellington,christchurch,queenstown,"
  + "sao paulo,são paulo,rio de janeiro,buenos aires,lima,bogota,bogotá,medellin,medellín,santiago,quito,montevideo,cartagena,cusco,"
  + "cairo,lagos,nairobi,cape town,johannesburg,casablanca,marrakech,marrakesh,accra,tunis").split(","),
);

/** Places from a locative preposition + a world-city gazetteer scan (supplements compromise.js). */
function supplementalPlaces(finding: string): string[] {
  const out = new Set<string>();
  for (let m; (m = PREP_PLACE.exec(finding)) !== null; ) {
    const cand = m[1].trim().replace(/[.,]$/, "");
    if (cand.length > 1 && !PLACE_STOP.has(cand.toLowerCase().split(/\s+/)[0])) out.add(cand);
  }
  const low = finding.toLowerCase();
  for (const city of CITY_GAZ) {
    if (low.includes(city) && new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low)) {
      out.add(city.replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()));
    }
  }
  // Long-tail world cities (pop >= 100k), disambiguated: a gazetteer name counts only if it is
  // Title-Cased or right after a locative preposition — so common-word city names don't over-fire.
  const toks = finding.split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const prev = i > 0 ? toks[i - 1].toLowerCase().replace(/[^a-z]/g, "") : "";
    const afterPrep = LOCATIVE.has(prev);
    for (let n = Math.min(3, toks.length - i); n >= 1; n--) {
      const key = foldPlace(toks.slice(i, i + n).join(" ")).replace(/[^a-z' .-]/g, "").trim();
      if (key.length >= 3 && WORLD_CITIES.has(key) && (/^[A-Z]/.test(toks[i]) || afterPrep)) {
        out.add(toks.slice(i, i + n).join(" ").replace(/[.,;:!?]+$/, ""));
        i += n - 1;
        break;
      }
    }
  }
  return [...out];
}

const FORBIDDEN = new Set(["Query", "StructuredRecord", "NamedEntity", "Org"]);

/**
 * Extract held identities from a finding for oasis_next. Hybrid, all LOCAL/serve-light (pure JS,
 * no live model download): compromise.js NER for Person/Place/Company (matches spaCy ~6/9 on the
 * battery) + the domain/`City, ST` regexes + a domain→Company derivation. Replaces the prior
 * regex-only path (1/9). See reports/oasis-implementation-plan.md (Phase 1).
 */
export function extractEntitiesFromFinding(finding: string): HeldEntity[] {
  const out: HeldEntity[] = [];
  const seen = new Set<string>();
  const add = (entity: string, value: string) => {
    const v = value.trim().replace(/[?.,!]+$/, "");
    if (!v) return;
    const k = `${entity}:${v.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ entity, value: v, kind: "identity" });
  };

  // Domain (regex — most reliable; compromise doesn't do domains).
  const domain = finding.match(DOMAIN_RE);
  if (domain) {
    add("Domain", domain[0].toLowerCase());
    // A domain usually names a Company too ("stripe.com" → Stripe) — derive it so a Company-bridge
    // is reachable even when compromise doesn't tag the org.
    const root = domain[0].toLowerCase().replace(/^www\./, "").split(".")[0];
    if (root && root.length > 1) add("Company", root[0].toUpperCase() + root.slice(1));
  }

  // compromise.js NER (pure JS) for Person / Place / Company.
  try {
    const doc = nlp(finding);
    for (const p of doc.people().out("array") as string[]) add("Person", p);
    for (const p of doc.places().out("array") as string[]) add("Place", p);
    for (const o of doc.organizations().out("array") as string[]) add("Company", o);
    // Last-resort: if NO Company was found, the salient proper noun (not a Person/Place) is
    // usually the org/brand the query is about (e.g. "Apple" in a stock query). Conservative —
    // fires once, only when needed — to avoid spurious Company entities. A brand/product gazetteer
    // would improve precision + ProductCategory typing (Phase-1 follow-up).
    if (!out.some((e) => e.entity === "Company")) {
      const claimed = new Set(out.map((e) => (e.value ?? "").toLowerCase()));
      const pn = (doc.match("#ProperNoun+").not("#Person").not("#Place").out("array") as string[])
        .find((x) => x.length > 1 && !claimed.has(x.toLowerCase()));
      if (pn) add("Company", pn);
    }
  } catch {
    /* compromise is best-effort; the regexes below still run */
  }

  // `City, ST` regex as a Place supplement.
  const place = finding.match(PLACE_RE);
  if (place) add("Place", `${place[1]}, ${place[2]}`);

  // Locative-preposition + world-city gazetteer — catches international / leading-sentence cities
  // that compromise.js misses.
  for (const p of supplementalPlaces(finding)) add("Place", p);

  return out;
}

export function extractEntities(opts: {
  finding?: string;
  explicitEntities?: HeldEntity[];
  source_intent_id?: string;
  bundle: IndexBundle;
  capabilitiesById: Map<string, CapabilityIntent>;
}): ExtractionResult {
  if (opts.explicitEntities?.length) {
    const entities = opts.explicitEntities
      .filter((e) => e.entity && !FORBIDDEN.has(e.entity))
      .map((e) => ({
        ...e,
        kind: e.kind ?? (V1_BRIDGE_IDENTITIES.includes(e.entity as (typeof V1_BRIDGE_IDENTITIES)[number]) ? "identity" : e.kind),
      }));
    return { entities, method: "explicit", confidence: "high" };
  }

  if (opts.finding) {
    const heuristic = extractEntitiesFromFinding(opts.finding);
    if (heuristic.length) {
      return { entities: heuristic, method: "heuristic", confidence: "medium" };
    }
  }

  if (opts.source_intent_id) {
    const intent = opts.capabilitiesById.get(opts.source_intent_id);
    if (intent) {
      const identityProduces = (intent.produces ?? [])
        .filter((p) => V1_BRIDGE_IDENTITIES.includes(p.entity as (typeof V1_BRIDGE_IDENTITIES)[number]))
        .map((p) => ({
          entity: p.entity,
          role: p.role === "identifier" || p.role === "payload" ? p.role : undefined,
          kind: "identity" as const,
        }));
      if (identityProduces.length) {
        return { entities: identityProduces, method: "intent_produces", confidence: "low" };
      }
    }
  }

  return { entities: [], method: "heuristic", confidence: "low" };
}