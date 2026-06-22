import type { EndpointRecord } from "./types.js";

/** All curated intent ids from ontology/intents/*.yaml */
export const CURATED_INTENT_IDS = [
  "ai.image_generate",
  "ai.llm_complete",
  "ai.speech_to_text",
  "ai.text_to_speech",
  "ai.embeddings",
  "ai.web_research",
  "ai.document_extract",
  "analyst.inflation_tracker",
  "cloud.domains",
  "comms.agent_inbox",
  "comms.send_email",
  "comms.send_fax",
  "comms.voice_call",
  "compute.blockchain_rpc",
  "data.company_enrich",
  "data.compute_answer",
  "data.email_validate",
  "data.exchange_rates",
  "data.ip_lookup",
  "data.job_search",
  "data.person_search",
  "data.ocr",
  "data.phone_validate",
  "data.translate_text",
  "data.weather_forecast",
  "data.web_scrape",
  "data.whois_lookup",
  "devtools.captcha_solve",
  "finance.crypto_spot_price",
  "finance.onchain_analytics",
  "finance.stock_quote",
  "finance.token_balance",
  "maps.places",
  "marketing.competitive_landscape",
  "media.social_data",
  "comms.send_sms",
  "realestate.property_lookup",
  "search.web",
  "shop.compare_price",
  "shop.find_deals",
  "shop.price_drop_alert",
  "shop.track_price_history",
  "social.influencer_search",
  "storage.hosting",
  "travel.place_reviews",
  "web.markdown_extract",
  "web.screenshot",
] as const;

export type CuratedIntentId = (typeof CURATED_INTENT_IDS)[number];

type IntentMatcher = (ep: EndpointRecord) => boolean;

function corpus(ep: EndpointRecord): string {
  return [ep.path, ep.summary, ep.description, ep.search_text, ep.category]
    .filter(Boolean)
    .join(" ");
}

function pathSummary(ep: EndpointRecord): string {
  return `${ep.path} ${ep.summary}`;
}

export const INTENT_MATCHERS: Record<CuratedIntentId, IntentMatcher> = {
  "ai.image_generate": (ep) => {
    const text = pathSummary(ep);
    const full = corpus(ep);
    return (
      /image|diffusion|sdxl|flux|dall|fal-ai/i.test(text) &&
      /generat|create|render|text.?to.?image/i.test(full)
    );
  },

  "ai.llm_complete": (ep) =>
    /chat.?completion|\/v1\/chat\/completions|llm.?complet|text.?generation/i.test(
      corpus(ep),
    ) && !/embeddings?/i.test(corpus(ep)),

  "ai.speech_to_text": (ep) => {
    const text = corpus(ep);
    return (
      /speech.?to.?text|transcri|whisper|\/stt|speech.?recognition/i.test(text) &&
      !/text.?to.?speech|tts/i.test(text)
    );
  },

  "ai.text_to_speech": (ep) =>
    /text.?to.?speech|texttospeech|\/tts|voice.?synthesis/i.test(corpus(ep)),

  "ai.embeddings": (ep) =>
    /\/embeddings|text.?embeddings?|vector.?embed|sentence.?embed/i.test(corpus(ep)),

  "ai.web_research": (ep) =>
    /perplexity|sonar|grounded.?research|web.?research|cited.?web|live.?research/i.test(
      corpus(ep),
    ),

  "ai.document_extract": (ep) => {
    const text = corpus(ep);
    return (
      /document.?extract|pdf.?pars|table.?extract|structured.?document|invoice.?extract/i.test(
        text,
      ) ||
      (/\/extract$/i.test(ep.path) &&
        /document|pdf|table|structured|invoice|scan/i.test(text))
    );
  },

  "analyst.inflation_tracker": (ep) =>
    /\/analyst\/inflation|price.?inflation|category.?inflation|inflation.?trend/i.test(
      corpus(ep),
    ),

  "cloud.domains": (ep) =>
    /domain\/renew|domain.?renew|domain.?regist|register.?domain|manage.?dns/i.test(
      corpus(ep),
    ),

  "comms.agent_inbox": (ep) =>
    /\/v0\/inboxes$/i.test(ep.path) && ep.method === "POST",

  "comms.send_email": (ep) => {
    const text = corpus(ep);
    return (
      (/\/send$/i.test(ep.path) || /\/api\/send/i.test(ep.path)) &&
      /email|mail|outbound.?message/i.test(text) &&
      !/fax|sms|text.?message/i.test(text)
    );
  },

  "comms.send_fax": (ep) => /fax/i.test(ep.path) || /fax/i.test(ep.summary),

  "comms.voice_call": (ep) => {
    const text = corpus(ep);
    return (
      /\/api\/call|voice.?call|outbound.?call|phone.?call|ai.?call/i.test(text) &&
      !/blockchain|json.?rpc|rpc/i.test(text)
    );
  },

  "compute.blockchain_rpc": (ep) => {
    const text = corpus(ep);
    return (
      /mainnet|json.?rpc|blockchain.?rpc|solana.?rpc|ethereum.?rpc|node.?rpc/i.test(
        text,
      ) && (/-mainnet\/?$/i.test(ep.path) || /rpc|json-rpc/i.test(text))
    );
  },

  "data.company_enrich": (ep) =>
    /company.?(enrich|enrichment)|firmographic|enrich.?company|company.?from.?domain/i.test(
      corpus(ep),
    ),

  "data.compute_answer": (ep) =>
    /wolfram|computational.?knowledge|\/v2\/query|math.?problem|unit.?conversion/i.test(
      corpus(ep),
    ),

  "data.email_validate": (ep) =>
    /email.?(reputation|validat|verif|deliverab)|validate.?email|disposable.?email/i.test(
      corpus(ep),
    ),

  "data.exchange_rates": (ep) =>
    /exchange.?rate|forex|currency.?convert|fx.?rate|foreign.?exchange/i.test(
      corpus(ep),
    ),

  "data.ip_lookup": (ep) =>
    /ip.?(intelligence|lookup|geoloc)|geo.?locate.?ip|threat.?intel.?ip/i.test(
      corpus(ep),
    ),

  "data.job_search": (ep) => {
    const text = corpus(ep);
    return (
      /\/v1\/active-ats|\/active-ats/i.test(ep.path) ||
      /job.?search|active.?ats|active.?jb|job.?board|job.?listing|hiring.?feed/i.test(
        text,
      )
    );
  },

  "data.person_search": (ep) => {
    const text = corpus(ep);
    return (
      /person\/search|people.?search|person.?lookup|public.?profile|contact.?discovery/i.test(
        text,
      ) && !/influencer|creator.?search/i.test(text)
    );
  },

  "data.ocr": (ep) => {
    const text = corpus(ep);
    return (
      /ocr|optical.?character|image.?to.?text|image-to-text|read.?text.?from.?image/i.test(
        text,
      ) && !/document.?extract|pdf.?pars|table.?extract/i.test(text)
    );
  },

  "data.phone_validate": (ep) =>
    /phone.?(intelligence|validat|verif)|validate.?phone|carrier.?lookup|line.?type/i.test(
      corpus(ep),
    ),

  "data.translate_text": (ep) => {
    const text = corpus(ep);
    return (
      /translate|translation|machine.?translat|\/deepl\/|localiz/i.test(text) &&
      !/speech|transcri|whisper/i.test(text)
    );
  },

  "data.weather_forecast": (ep) => {
    const text = corpus(ep);
    return (
      /weather|forecast|current.?weather|air.?quality/i.test(text) &&
      !/tripadvisor|travel.?review/i.test(text)
    );
  },

  "data.web_scrape": (ep) => {
    const text = corpus(ep);
    return (
      /scrape|web.?scrap|crawl.?url|fetch.?page/i.test(text) &&
      !/proxy|storage|interest|markdown|screenshot/i.test(text)
    );
  },

  "data.whois_lookup": (ep) => {
    const text = corpus(ep);
    return (
      (/whois|dns.?record|nameserver|mx.?record|registrar/i.test(text) &&
        /lookup|dns|whois/i.test(text)) ||
      /dns.?lookup|lookup.?dns.?and.?whois/i.test(text)
    ) && !/domain.?renew|domain.?regist/i.test(text);
  },

  "devtools.captcha_solve": (ep) =>
    /captcha|recaptcha|hcaptcha|turnstile|createTask/i.test(corpus(ep)),

  "finance.crypto_spot_price": (ep) => {
    const text = corpus(ep);
    return (
      /crypto.?price|coin.?price|token.?price|spot.?price|coingecko|bitcoin.?price/i.test(
        text,
      ) && !/smart.?money|on.?chain.?analyt|wallet.?analyt/i.test(text)
    );
  },

  "finance.onchain_analytics": (ep) =>
    /smart.?money|on.?chain.?analyt|wallet.?analyt|token.?holder|fund.?flow|netflow/i.test(
      corpus(ep),
    ),

  "finance.stock_quote": (ep) => {
    const text = corpus(ep);
    if (/\/alphavantage\/global-quote|global.?quote/i.test(text)) return true;
    return (
      /time.?series.?intraday|stock.?quote|equity.?quote/i.test(text) ||
      (/stock|equity|ticker/i.test(text) && /quote|intraday|market.?data/i.test(text))
    );
  },

  "finance.token_balance": (ep) => {
    const text = corpus(ep);
    return (
      /token.?balance|wallet.?balance|erc.?1155|holdings/i.test(text) &&
      !/nft|ownerof|proxy|json.?rpc|mainnet/i.test(text)
    );
  },

  "maps.places": (ep) => {
    const text = corpus(ep);
    return (
      /places:search|\/places\/search|searchnearby|searchtext/i.test(ep.path) ||
      (/places|poi|point.?of.?interest/i.test(text) &&
        /search|nearby|local|business/i.test(text) &&
        !/tripadvisor|travel.?review/i.test(text))
    );
  },

  "marketing.competitive_landscape": (ep) =>
    /\/marketing\/competitive|competitive.?landscape|category.?landscape|market.?landscape/i.test(
      corpus(ep),
    ) || /\/v1\/marketing\/competitive-landscape/i.test(ep.path),

  "media.social_data": (ep) => {
    const text = corpus(ep);
    return (
      /post.?comment|social.?media|\/facebook\/|\/instagram\/|\/tiktok\/|\/reddit\//i.test(
        text,
      ) && !/influencer/i.test(text)
    );
  },

  "comms.send_sms": (ep) => {
    const text = corpus(ep);
    return (
      /\/text$/i.test(ep.path) ||
      (/send.?sms|outbound.?sms|text.?message|sms.?verif/i.test(text) &&
        !/speech|transcri|whisper/i.test(text))
    );
  },

  "realestate.property_lookup": (ep) => {
    const text = corpus(ep);
    return (
      /listings\/sale|property.?list|rental.?list|homes?.?for.?sale|real.?estate.?search/i.test(
        text,
      ) ||
      (/property|rental|rentcast/i.test(text) && /list|search|lookup|estimate/i.test(text))
    );
  },

  "search.web": (ep) => {
    const text = corpus(ep);
    if (
      /\/search$/i.test(ep.path) &&
      /serper|google.?search|organic.?search|organic.?results|serp/i.test(text)
    ) {
      return true;
    }
    return (
      (/\/search/i.test(ep.path) ||
        /\/api\/serper\/search|organic.?search|web.?search|google.?search|serp/i.test(
          text,
        )) &&
      !/perplexity|sonar|smart.?money|influencer|person\/search|deal.?finder|image.?search|news.?search/i.test(
        text,
      )
    );
  },

  "shop.compare_price": (ep) =>
    /\/shopper\/best-price|best.?price|price.?compar|compare.?price|cheapest.?price|cross.?retailer/i.test(
      corpus(ep),
    ),

  "shop.find_deals": (ep) =>
    /\/shopper\/deal-finder|deal.?finder|find.?deal|discounted.?product|on.?sale|clearance/i.test(
      corpus(ep),
    ),

  "shop.price_drop_alert": (ep) =>
    /\/shopper\/price-drop|price.?drop|price.?alert|price.?decrease|recent.?markdown/i.test(
      corpus(ep),
    ) || /\/v1\/shopper\/price-drop-alert/i.test(ep.path),

  "shop.track_price_history": (ep) =>
    /\/shopper\/price-history|price.?history|historical.?pric|track.?price|price.?trend/i.test(
      corpus(ep),
    ),

  "social.influencer_search": (ep) =>
    /influencer|creator.?search|creator.?discovery/i.test(corpus(ep)),

  "storage.hosting": (ep) => {
    const text = corpus(ep);
    return (
      /\/upload|static.?site|static.?website|file.?upload|\/api\/site|cdn.?url/i.test(
        text,
      ) && !/document.?extract|ocr/i.test(text)
    );
  },

  "travel.place_reviews": (ep) => {
    const text = corpus(ep);
    return (
      /\/api\/v1\/location|tripadvisor|place.?review|travel.?review|hotel.?review/i.test(
        text,
      ) ||
      (/\/location/i.test(ep.path) &&
        /review|hotel|restaurant|attraction|nearby/i.test(text))
    );
  },

  "web.markdown_extract": (ep) => {
    const text = corpus(ep);
    if (
      /serper-scrape|serper.?scrape/i.test(`${ep.origin} ${text}`) &&
      /markdown|clean.?text/i.test(text)
    ) {
      return true;
    }
    return (
      /markdown|url.?to.?markdown|page.?to.?markdown|webpage.?to.?markdown|clean.?text/i.test(
        text,
      ) ||
      (/serper.?scrape|webpage.?extract/i.test(text) &&
        /markdown|clean.?text|readable/i.test(text))
    );
  },

  "web.screenshot": (ep) =>
    /screenshot|page.?capture|website.?snapshot|full.?page.?png/i.test(corpus(ep)),
};

export function intentIdsFromMatchers(): string[] {
  return Object.keys(INTENT_MATCHERS);
}

export function matchEndpointsForIntent(
  intentId: string,
  endpoints: EndpointRecord[],
): EndpointRecord[] {
  const matcher = INTENT_MATCHERS[intentId as CuratedIntentId];
  if (!matcher) return [];
  return endpoints.filter(matcher);
}