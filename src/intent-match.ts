/**
 * Curated intent ids from ontology/intents/*.yaml.
 *
 * The per-intent regex matchers that used to live here (INTENT_MATCHERS /
 * matchEndpointsForIntent) are gone: endpoint→intent binding is now semantic
 * (see embed/bind-endpoints.ts — cosine similarity + floor), which is both more
 * accurate and scales without per-intent rules. Only the id list remains, used
 * to scope materialization and binding to the curated set.
 */
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
