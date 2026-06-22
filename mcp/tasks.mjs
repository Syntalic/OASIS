// Shared probe tasks: real, oblique phrasings (deliberately not the intent labels)
// + the capability an agent SHOULD reach. Used by probe.mjs (OASIS-only) and
// compare.mjs (OASIS vs baseline discovery methods, end-to-end through an agent).
export const TASKS = [
  { q: "grab a screenshot of competitor.com's pricing page for a slide deck", expect: "web.screenshot" },
  { q: "what's one ether worth in dollars right now", expect: "finance.crypto_spot_price" },
  { q: "transcribe this earnings-call recording into text", expect: "ai.speech_to_text" },
  { q: "find the cheapest place to buy a Nintendo Switch", expect: "shop.compare_price" },
  { q: "translate this support reply into Japanese", expect: "data.translate_text" },
  { q: "before I email this list, which addresses will bounce", expect: "data.email_validate" },
  { q: "give me a well-sourced summary of recent EU AI Act news with citations", expect: "ai.web_research" },
  { q: "pull the line items and totals out of this PDF invoice", expect: "ai.document_extract" },
  { q: "should I pack an umbrella in Lisbon this weekend", expect: "data.weather_forecast" },
  { q: "find sushi restaurants near my hotel in Tokyo", expect: "maps.places" },
  { q: "send a one-time code over text to a customer's phone", expect: "comms.send_sms" },
  { q: "make an image of a robot barista", expect: "ai.image_generate" },
  { q: "who registered the domain acme.com and where is it hosted", expect: "data.whois_lookup" },
  { q: "what city is the visitor on IP 8.8.8.8 in", expect: "data.ip_lookup" },
  { q: "find two-bedroom apartments for sale in Miami", expect: "realestate.property_lookup" },
  { q: "turn these product descriptions into vectors for semantic search", expect: "ai.embeddings" },
  { q: "what's Nvidia stock doing today", expect: "finance.stock_quote" },
  { q: "scrape the full contents of this product page", expect: "data.web_scrape" },
];
