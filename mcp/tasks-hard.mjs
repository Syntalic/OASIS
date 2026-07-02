// HARD / trap task set: oblique phrasings whose obvious keywords also match a
// SIBLING capability, so raw keyword-over-endpoints is prone to grabbing the wrong
// one (text-to-speech for a transcribe task, a screenshot for an HTML-scrape task,
// send-email for an email-VALIDATE task). This is where the capability ontology
// (distinct intents, negative terms, facets) should disambiguate and beat keyword.
// Scoring is the same method-neutral judge (task vs chosen endpoint), so `expect`
// is only a label — the trap is in the phrasing.
export const TASKS = [
  { q: "I recorded a voice memo of my idea — I need it written out as text", expect: "ai.speech_to_text", trap: "text_to_speech" },
  { q: "turn this blog post into an audio version my users can listen to", expect: "ai.text_to_speech", trap: "speech_to_text" },
  { q: "I need the raw HTML source of this competitor's landing page, not a picture of it", expect: "web.scrape", trap: "screenshot" },
  { q: "save this webpage as an image I can paste into a slide deck", expect: "web.screenshot", trap: "web_scrape" },
  { q: "give me a clean markdown version of this article for my notes", expect: "web.markdown_extract", trap: "web_scrape" },
  { q: "before I send my newsletter, weed out the addresses that will bounce", expect: "utility.email_validate", trap: "send_email" },
  { q: "text my customer their appointment reminder", expect: "comms.send_sms", trap: "send_email/voice_call" },
  { q: "is this phone number actually a working mobile line", expect: "utility.phone_validate", trap: "send_sms" },
  { q: "pull the vendor, total and date as structured fields from this scanned receipt", expect: "ai.document_extract", trap: "ocr" },
  { q: "just give me the plain text printed on this scanned page", expect: "ai.ocr", trap: "document_extract" },
  { q: "what is one bitcoin worth in euros right this second", expect: "finance.crypto_spot_price", trap: "stock_quote/exchange_rates" },
  { q: "convert 500 US dollars into Japanese yen at today's rate", expect: "finance.exchange_rates", trap: "crypto_spot_price" },
  { q: "who is the registrant behind the domain name acme.com", expect: "devtools.whois_lookup", trap: "ip_lookup" },
  { q: "what software and frameworks is this website built with", expect: "data.builtwith", trap: "web_scrape/whois" },
  { q: "generate a product photo of a red sneaker on a white background", expect: "ai.image_generate", trap: "screenshot" },
  { q: "give me a sourced, citation-backed briefing on the latest EU AI Act developments", expect: "ai.web_research", trap: "llm_complete/web_scrape" },
];
