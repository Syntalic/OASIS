# OASIS Next — dogfood chains (topical-relevance ranking, fresh full-build index)

Local MCP, fresh production build. Ranking: **score = structural(port-match) × topical(finding↔intent)**
+ small domain/quality nudges; same-domain bridges allowed; a relevance floor prunes tangential ones.
Each scenario: **find** → **reflect** (identities held) → **oasis_next** (relevance-ranked follow-ups).

---

## 1. 💹 Financial analyst — Company
**Finding:** Tesla's Q3 deliveries beat estimates.

**find** — `"current stock price and quote for Tesla"`

- POST https://stock-price.api.klymax402.com/api/quote  $0.002 [x402] _via:finance.stock_quote_
- POST https://api.getanyapi.com/v1/run/yahoo_finance.quote  $— [x402,mpp] _via:finance.stock_quote_
- POST https://2s.io/api/watchers/stock-price  $0.05 [x402] _via:finance.stock_quote_
- POST https://x402-market-intel-mcp.mtree.workers.dev/v1/x402/financial_data_route_preflight  $0.04 [x402] _via:finance.stock_quote_

**reflect — identities held:** `Company="Tesla"`

**oasis_next**(`intent_id=finance.stock_quote`, finding=_"Tesla Q3 deliveries beat estimates"_) →

_2 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| Company | media.social_data | POST https://x402.agentutility.ai/twitter-x-api | $0.01 | Fetch social media posts and comments can investigate Company you hold (Tesla) |
| Company | data.job_search | GET https://2s.io/api/gov/usajobs | $0.001 | Search job postings and hiring feeds can investigate Company you hold (Tesla) |

### ↳ second hop — hold a Person surfaced from the company

**reflect — identities held:** `Person="Elon Musk"`

**oasis_next**(`intent_id=data.person_search`, finding=_"Tesla's CEO is Elon Musk"_) →

_1 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| Person | media.social_data | POST https://x402.agentutility.ai/twitter-x-api | $0.01 | Fetch social media posts and comments can investigate Person you hold (Elon Musk) |

---

## 2. 📊 Marketing analyst — Place + ProductCategory
**Finding:** Consumer-electronics prices are down 12% YoY in Los Angeles.

**find** — `"competitive pricing for consumer electronics"`

- GET https://dealpulse-weld.vercel.app/api/deals/compare  $— [] _via:endpoint-arm_
- POST https://solopreneur.apitoai.xyz/pricing_strategist  $— [x402] _via:endpoint-arm_
- GET https://orbisapi.com/proxy/pricing-war-analyzer-api-23a3f5  $0.008 [x402] _via:endpoint-arm_
- GET https://api.strale.io/x402/price-compare  $0.216 [x402] _via:endpoint-arm_

**reflect — identities held:** `Place="Los Angeles, CA"`, `ProductCategory="consumer electronics"`

**oasis_next**(`intent_id=analyst.inflation_tracker`, finding=_"LA consumer-electronics prices down 12% YoY"_) →

_3 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| ProductCategory | shop.find_deals | POST https://convrgent.ai/api/kyb/winloss | $— | Find discounted products in a category can investigate ProductCategory you hold (consumer electronics) |
| ProductCategory | marketing.competitive_landscape | POST https://x402-market-intel-mcp.mtree.workers.dev/v1/x402/micro_price_optimizer | $0.08 | Competitive pricing landscape for a category can investigate ProductCategory you hold (consumer electronics) |
| Place | realestate.property_lookup | POST https://x402.agentutility.ai/property-tax-assessment | $0.01 | Search homes and rentals for sale can investigate Place you hold (Los Angeles, CA) |

---

## 3. 📇 Sales / BDR — Company + Domain + Place
**Finding:** Acme Corp (acme.com) is hiring aggressively in Austin.

**find** — `"enrich a company from its website domain"`

- GET https://lionx402.com/api/x402/enrich-v1-json  $0.002 [x402] _via:data.company_enrich_
- POST https://x402.agentutility.ai/sales-lead-domain-enrich  $0.02 [x402] _via:data.company_enrich_
- POST https://stable-leadmagic.dev/api/company-search  $0.03 [x402] _via:data.company_enrich_
- POST https://stableenrich.dev/api/companyenrich/properties-enrich  $0.06 [x402,mpp] _via:data.company_enrich_

**reflect — identities held:** `Company="Acme Corp"`, `Domain="acme.com"`, `Place="Austin, TX"`

**oasis_next**(`intent_id=data.company_enrich`, finding=_"Acme Corp is hiring aggressively in Austin"_) →

_4 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| Company | data.job_search | GET https://2s.io/api/gov/usajobs | $0.001 | Search job postings and hiring feeds can investigate Company you hold (Acme Corp) |
| Place | realestate.property_lookup | POST https://x402.agentutility.ai/property-tax-assessment | $0.01 | Search homes and rentals for sale can investigate Place you hold (Austin, TX) |
| Place | maps.places | POST https://api.locus.report/api/locus-local-trend-brief | $0.05 | Search local businesses and points of interest can investigate Place you hold (Austin, TX) |
| Company | data.person_search | POST https://x402.agentutility.ai/people-enrich | $0.01 | Search for people and public profiles can investigate Company you hold (Acme Corp) |

---

## 4. ✈️ Traveler — Place
**Finding:** Planning a trip to Tokyo.

**find** — `"top-rated hotels and reviews in Tokyo"`

- POST https://apify-dlfd68ww7-merit-systems.vercel.app/api/actors/compass/Google-Maps-Reviews-Scraper/call  $0.01 [x402] _via:travel.place_reviews_
- POST https://apify-pjhpk2l0p-merit-systems.vercel.app/api/actors/compass/Google-Maps-Reviews-Scraper/call  $0.01 [x402] _via:travel.place_reviews_
- POST https://x402.agentutility.ai/ecommerce-review-sentiment  $0.01 [x402] _via:travel.place_reviews_
- POST https://api.getanyapi.com/v1/run/maps.reviews  $— [x402,mpp] _via:travel.place_reviews_

**reflect — identities held:** `Place="Tokyo, Japan"`

**oasis_next**(`intent_id=travel.place_reviews`, finding=_"Planning a trip to Tokyo"_) →

_3 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| Place | travel.aviation | POST https://x402.agentutility.ai/flight-status | $0.01 | Search flights, airports, and aviation data can investigate Place you hold (Tokyo, Japan) |
| Place | maps.places | POST https://api.locus.report/api/locus-local-trend-brief | $0.05 | Search local businesses and points of interest can investigate Place you hold (Tokyo, Japan) |
| Place | data.weather_forecast | POST https://x402.agentutility.ai/weather-forecast | $0.005 | Get current weather and forecasts can investigate Place you hold (Tokyo, Japan) |

---

## 5. 🧑‍💼 Recruiter — Person + Company
**Finding:** Jane Smith at Stripe is a strong hire candidate.

**find** — `"find people and profiles at a company"`

- POST https://x402.agentutility.ai/people-search  $0.01 [x402] _via:data.person_search_
- POST https://win.oneshotagent.com/v1/tools/research/person  $— [x402] _via:data.person_search_
- POST https://stableenrich.dev/api/whitepages/person-search  $0.22 [x402,mpp] _via:data.person_search_
- GET https://411data.io/api/v1/enrich/lead-session/slot-person  $0.35 [x402,mpp] _via:data.person_search_

**reflect — identities held:** `Person="Jane Smith"`, `Company="Stripe"`

**oasis_next**(`intent_id=data.person_search`, finding=_"Jane Smith at Stripe is a strong candidate"_) →

_1 leads_

| bridge | → intent | endpoint | price | why |
|---|---|---|---|---|
| Company | data.job_search | GET https://2s.io/api/gov/usajobs | $0.001 | Search job postings and hiring feeds can investigate Company you hold (Stripe) |
