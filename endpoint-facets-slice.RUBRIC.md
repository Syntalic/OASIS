# Facet labeling rubric — fill `action` (required) and `domain_corrected` (only if wrong)

Classify what each ENDPOINT actually does, independently — do NOT copy the bound intent's facet.
Edit ONLY the `action` and `domain_corrected` columns. Never change `key` (it joins your labels back).

## `action` — pick exactly one (closed enum; these are the values the ontology already uses):
- **search** — Find/list matching items by a query (web, people, jobs, places, product search).  _(intents: ai.web_research, data.job_search, data.person_search, realestate.property_lookup)_
- **lookup** — Fetch known data by id/params — get/read/resolve/check/list-by-id/whois/price-now.  _(intents: data.company_enrich, data.exchange_rates, data.agriculture_stats, data.gov_civic)_
- **compare** — Compare the SAME item across sources (e.g. one product's price across retailers).  _(intents: shop.compare_price)_
- **extract** — Pull structured data OUT of unstructured input — OCR, PDF/table parse, scrape→data.  _(intents: ai.document_extract, data.ocr, data.web_scrape, web.markdown_extract)_
- **generate** — Create NEW content from a prompt — image generation, text-to-speech, text generation.  _(no intent uses this yet)_
- **transform** — Convert/modify EXISTING content — translate, resize, transcode, reformat.  _(intents: ai.speech_to_text, ai.text_to_speech, compute.convert_units, devtools.pdf_manipulate)_
- **validate** — Verify correctness/validity — email validation, verify a domain/address, check a signature.  _(intents: data.gov_records, data.iban_validate, data.vat_validate)_
- **send** — Deliver a message/payload outward — send email/SMS, post a message, dispatch a webhook.  _(intents: comms.send_email, comms.send_fax, comms.voice_call, comms.send_sms)_
- **provision** — Create/register/allocate/PURCHASE a resource — register a domain, create an inbox, buy.  _(intents: cloud.domains, comms.agent_inbox)_
- **analyze** — Score/assess/derive insight — sentiment, risk score, analytics, ratings, trends.  _(intents: analyst.inflation_tracker, finance.onchain_analytics, marketing.competitive_landscape)_
- **execute** — Run a computation/transaction/RPC — execute code, submit a trade, blockchain RPC call.  _(intents: compute.blockchain_rpc, compute.financial_calculator, devtools.webhook_tools)_
- **monitor** — Watch/track over time or alert — price alerts, status watch, change/depeg tracking.  _(intents: data.airdrop_tracker, finance.stablecoin_monitor, shop.price_drop_alert)_

## `domain_corrected` — leave BLANK if `regex_domain` is correct; else pick one:
`shop | ai | data | web | comms | finance | maps | travel | realestate | social | media | marketing | analyst | cloud | compute | devtools | storage | search | crypto`
(The regex deriver is noisy — e.g. it tags a "store a document scoped to your wallet" endpoint
as `crypto` because of the word "wallet". Fix only clear errors; blank = regex was fine.)

## Notes
- "register/renew/buy a domain" → action **provision**; "check if a domain is available" → **lookup**.
- "Amazon product reviews", "Wirecutter reviews" → domain **shop** (these are the bleed we're separating from travel).
- Return the CSV with the same columns; I join on `key` and apply your labels as authored overrides.
