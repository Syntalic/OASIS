import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endpointId } from "../core/id.js";
import type { CapabilityIntent, EndpointRecord, IndexBundle } from "../core/types.js";
import type { EvalQuery } from "./discovery-benchmark.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..", "..");

const ACTION_WORDS =
  /\b(send|find|get|lookup|enrich|scrape|call|price|register|upload|solve|transcribe|generate|compare|track|search|convert|validate|check|create|host|tip|fax|email|buy|sell|rent|deploy|analyze|monitor|fetch|extract|translate|summarize)\b/i;

const PARAPHRASE_PREFIXES = [
  "",
  "I need to ",
  "find a paid api to ",
  "agent wants to ",
];

const PARAPHRASE_SUFFIXES = ["", " via micropayment"];

function isUsefulPhrase(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (trimmed.length < 10) return false;
  if (trimmed.length >= 28) return true;
  if (ACTION_WORDS.test(trimmed)) return true;
  return trimmed.split(/\s+/).length >= 4;
}

function endpointExists(
  endpoints: EndpointRecord[],
  ref: { origin: string; method: string; path: string },
): boolean {
  const id = endpointId(ref.origin, ref.method, ref.path);
  return endpoints.some((e) => e.id === id);
}

function sampleRef(cap: CapabilityIntent) {
  return cap.satisfies[0];
}

function slug(id: string): string {
  return id.replace(/[._]/g, "-");
}

function uniqueQueries(items: EvalQuery[]): EvalQuery[] {
  const seen = new Set<string>();
  const out: EvalQuery[] = [];
  for (const item of items) {
    const key = item.query.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function queriesFromCapability(
  cap: CapabilityIntent,
  endpoints: EndpointRecord[],
  maxPerCap = 4,
): EvalQuery[] {
  const ref = sampleRef(cap);
  if (!ref || !endpointExists(endpoints, ref)) return [];

  const phrases = new Set<string>();
  phrases.add(cap.label);
  if (cap.description) phrases.add(cap.description);
  for (const alias of cap.aliases ?? []) phrases.add(alias);

  const generated: EvalQuery[] = [];
  let n = 0;

  for (const phrase of phrases) {
    if (!isUsefulPhrase(phrase)) continue;
    for (const prefix of PARAPHRASE_PREFIXES) {
      for (const suffix of PARAPHRASE_SUFFIXES) {
        if (n >= maxPerCap) break;
        const query = `${prefix}${phrase}${suffix}`.trim();
        if (query.length < 12 || query.length > 120) continue;
        generated.push({
          id: `${slug(cap.id)}-${n + 1}`,
          query,
          expect_intent: cap.id,
          expect_endpoint: {
            origin: ref.origin,
            method: ref.method,
            path: ref.path,
          },
        });
        n += 1;
      }
      if (n >= maxPerCap) break;
    }
    if (n >= maxPerCap) break;
  }

  return generated;
}

const HAND_CURATED: EvalQuery[] = [
  {
    id: "shop-compare-1",
    query: "cheapest airpods pro across retailers",
    expect_intent: "shop.compare_price",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/best-price",
    },
  },
  {
    id: "shop-compare-2",
    query: "find the best price for a product",
    expect_intent: "shop.compare_price",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/best-price",
    },
  },
  {
    id: "shop-deals-1",
    query: "find discounted electronics deals",
    expect_intent: "shop.find_deals",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/deal-finder",
    },
  },
  {
    id: "shop-drop-1",
    query: "has the price dropped on this product recently",
    expect_intent: "shop.price_drop_alert",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/price-drop-alert",
    },
  },
  {
    id: "shop-history-1",
    query: "price history trend for a product",
    expect_intent: "shop.track_price_history",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/price-history",
    },
  },
  {
    id: "marketing-landscape-1",
    query: "competitive pricing landscape for a category",
    expect_intent: "marketing.competitive_landscape",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/marketing/competitive-landscape",
    },
  },
  {
    id: "analyst-inflation-1",
    query: "track price inflation in grocery category",
    expect_intent: "analyst.inflation_tracker",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/analyst/inflation",
    },
  },
  {
    id: "comms-email-1",
    query: "send an outbound email without api keys",
    expect_intent: "comms.send_email",
    expect_endpoint: {
      origin: "https://stableemail.dev",
      method: "POST",
      path: "/api/send",
    },
  },
  {
    id: "comms-email-2",
    query: "email delivery micropayment",
    expect_intent: "comms.send_email",
    expect_endpoint: {
      origin: "https://stableemail.dev",
      method: "POST",
      path: "/api/send",
    },
  },
  {
    id: "comms-voice-1",
    query: "place an ai phone call outbound",
    expect_intent: "comms.voice_call",
    expect_endpoint: {
      origin: "https://stablephone.dev",
      method: "POST",
      path: "/api/call",
    },
  },
  {
    id: "finance-crypto-1",
    query: "bitcoin spot price usd",
    expect_intent: "finance.crypto_spot_price",
    expect_endpoint: {
      origin: "https://stablecrypto.dev",
      method: "POST",
      path: "/api/coingecko/price",
    },
  },
  {
    id: "compute-rpc-1",
    query: "solana json-rpc node call",
    expect_intent: "blockchain.rpc",
    expect_endpoint: {
      origin: "https://x402.quicknode.com",
      method: "POST",
      path: "/solana-mainnet/",
    },
  },
  {
    id: "mpp-fax-1",
    query: "send a fax per page micropayment",
    expect_intent: "comms.send_fax",
    expect_endpoint: {
      origin: "https://agentfax.val.run",
      method: "POST",
      path: "/v1/fax",
    },
  },
  {
    id: "mpp-agentmail-1",
    query: "ai agent email inbox",
    expect_intent: "comms.agent_inbox",
    expect_endpoint: {
      origin: "https://mpp.api.agentmail.to",
      method: "POST",
      path: "/v0/inboxes",
    },
  },
  {
    id: "shop-compare-3",
    query: "lowest price on sony wh-1000xm5 headphones",
    expect_intent: "shop.compare_price",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/best-price",
    },
  },
  {
    id: "shop-compare-4",
    query: "where can I buy this cheaper walmart or amazon",
    expect_intent: "shop.compare_price",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/best-price",
    },
  },
  {
    id: "shop-deals-2",
    query: "show me on sale kitchen appliances",
    expect_intent: "shop.find_deals",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/shopper/deal-finder",
    },
  },
  {
    id: "analyst-inflation-2",
    query: "how much have grocery prices increased this year",
    expect_intent: "analyst.inflation_tracker",
    expect_endpoint: {
      origin: "https://api.syntalic.com",
      method: "GET",
      path: "/v1/analyst/inflation",
    },
  },
  {
    id: "comms-voice-2",
    query: "call a customer to confirm their appointment",
    expect_intent: "comms.voice_call",
    expect_endpoint: {
      origin: "https://stablephone.dev",
      method: "POST",
      path: "/api/call",
    },
  },
  {
    id: "finance-crypto-2",
    query: "what is the current eth price",
    expect_intent: "finance.crypto_spot_price",
    expect_endpoint: {
      origin: "https://stablecrypto.dev",
      method: "POST",
      path: "/api/coingecko/price",
    },
  },
  {
    id: "compute-rpc-2",
    query: "ethereum mainnet json rpc proxy",
    expect_intent: "blockchain.rpc",
    expect_endpoint: {
      origin: "https://x402.quicknode.com",
      method: "POST",
      path: "/ethereum-mainnet/",
    },
  },
  {
    id: "data-enrich-1",
    query: "enrich a company from its domain name",
    expect_intent: "data.company_enrich",
    expect_endpoint: {
      origin: "https://abstract-company-enrichment.mpp.paywithlocus.com",
      method: "POST",
      path: "/abstract-company-enrichment/lookup",
    },
  },
  {
    id: "data-scrape-1",
    query: "scrape a webpage and extract content",
    expect_intent: "data.web_scrape",
    expect_endpoint: {
      origin: "https://abstract-web-scraping.mpp.paywithlocus.com",
      method: "POST",
      path: "/abstract-web-scraping/scrape",
    },
  },
  {
    id: "ai-image-1",
    query: "generate an image from a text prompt",
    expect_intent: "ai.image_generate",
    expect_endpoint: {
      origin: "https://fal.x402.paysponge.com",
      method: "POST",
      path: "/fal-ai/fast-sdxl",
    },
  },
  {
    id: "ai-llm-1",
    query: "ask perplexity a research question with citations",
    expect_intent: "ai.llm_complete",
    expect_endpoint: {
      origin: "https://pplx.x402.paysponge.com",
      method: "GET",
      path: "/v1/async/sonar/{api_request}",
    },
  },
  {
    id: "devtools-captcha-1",
    query: "solve recaptcha for my web agent",
    expect_intent: "compute.captcha_solve",
    expect_endpoint: {
      origin: "https://2captcha.x402.paysponge.com",
      method: "POST",
      path: "/createTask",
    },
  },
  {
    id: "web-screenshot-1",
    query: "take a screenshot of a website url",
    expect_intent: "web.screenshot",
    expect_endpoint: {
      origin: "https://screenshotone.x402.paysponge.com",
      method: "GET",
      path: "/take",
    },
  },
  {
    id: "realestate-1",
    query: "find homes for sale in austin texas",
    expect_intent: "realestate.property_lookup",
    expect_endpoint: {
      origin: "https://rentcast.x402.paysponge.com",
      method: "GET",
      path: "/listings/sale",
    },
  },
  {
    id: "social-influencer-1",
    query: "find instagram influencers in fitness niche",
    expect_intent: "social.influencer_search",
    expect_endpoint: {
      origin: "https://api.socialintel.dev",
      method: "GET",
      path: "/v1/search",
    },
  },
  {
    id: "cloud-domain-1",
    query: "register a new domain name for my agent",
    expect_intent: "cloud.domains",
    expect_endpoint: {
      origin: "https://stabledomains.dev",
      method: "POST",
      path: "/api/register",
    },
  },
  {
    id: "storage-host-1",
    query: "host a static website file upload",
    expect_intent: "storage.hosting",
    expect_endpoint: {
      origin: "https://stableupload.dev",
      method: "POST",
      path: "/api/site",
    },
  },
];

export async function generateEvalQueries(
  bundle: IndexBundle,
  options: { maxPerCapability?: number } = {},
): Promise<EvalQuery[]> {
  const maxPerCap = options.maxPerCapability ?? 3;
  const generated: EvalQuery[] = [...HAND_CURATED];

  const curatedIds = new Set(
    HAND_CURATED.map((q) => q.expect_intent).filter(Boolean) as string[],
  );

  for (const cap of bundle.capabilities) {
    if (curatedIds.has(cap.id) && cap.id.startsWith("shop.")) continue;
    generated.push(...queriesFromCapability(cap, bundle.endpoints, maxPerCap));
  }

  return uniqueQueries(generated).filter((q) => {
    if (!q.expect_endpoint) return false;
    return endpointExists(bundle.endpoints, q.expect_endpoint);
  });
}

async function main(): Promise<void> {
  const raw = await readFile(path.join(PACKAGE_ROOT, "dist", "index.json"), "utf8");
  const bundle = JSON.parse(raw) as IndexBundle;
  const queries = await generateEvalQueries(bundle, { maxPerCapability: 3 });
  const outPath = path.join(PACKAGE_ROOT, "eval", "queries.json");
  await writeFile(outPath, JSON.stringify(queries, null, 2) + "\n");
  console.log(`Wrote ${queries.length} queries to ${outPath}`);
}

const isMain = process.argv[1]?.includes("generate-queries");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}