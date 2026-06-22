import type { EndpointRecord } from "./types.js";
/** All curated intent ids from ontology/intents/*.yaml */
export declare const CURATED_INTENT_IDS: readonly ["ai.image_generate", "ai.llm_complete", "ai.speech_to_text", "ai.text_to_speech", "ai.embeddings", "ai.web_research", "ai.document_extract", "analyst.inflation_tracker", "cloud.domains", "comms.agent_inbox", "comms.send_email", "comms.send_fax", "comms.voice_call", "compute.blockchain_rpc", "data.company_enrich", "data.compute_answer", "data.email_validate", "data.exchange_rates", "data.ip_lookup", "data.job_search", "data.person_search", "data.ocr", "data.phone_validate", "data.translate_text", "data.weather_forecast", "data.web_scrape", "data.whois_lookup", "devtools.captcha_solve", "finance.crypto_spot_price", "finance.onchain_analytics", "finance.stock_quote", "finance.token_balance", "maps.places", "marketing.competitive_landscape", "media.social_data", "comms.send_sms", "realestate.property_lookup", "search.web", "shop.compare_price", "shop.find_deals", "shop.price_drop_alert", "shop.track_price_history", "social.influencer_search", "storage.hosting", "travel.place_reviews", "web.markdown_extract", "web.screenshot"];
export type CuratedIntentId = (typeof CURATED_INTENT_IDS)[number];
type IntentMatcher = (ep: EndpointRecord) => boolean;
export declare const INTENT_MATCHERS: Record<CuratedIntentId, IntentMatcher>;
export declare function intentIdsFromMatchers(): string[];
export declare function matchEndpointsForIntent(intentId: string, endpoints: EndpointRecord[]): EndpointRecord[];
export {};
