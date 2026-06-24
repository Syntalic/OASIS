# OASIS Investigate — dogfood log

## 1. LA sales investigation

- **Query:** Why are LA electronics sales down?
- **find:** `analyst.inflation_tracker`
- **reflect:** Place=Los Angeles CA, ProductCategory=consumer electronics
- **next:** weather + competitive landscape leads
- **Result:** ≥2 hops, synthesis cites endpoints

## 2. Competitor Company intel

- **find:** `marketing.competitive_landscape`
- **reflect:** Company=Acme Corp
- **next:** social_data, person_search
- **Result:** agent declared Company, called ≥1 follow-up

## 3. Domain / brand intel

- **find:** `data.whois_lookup` on acme.com
- **reflect:** Domain=acme.com
- **next:** cloud.domains
- **Result:** cross-domain whois → domains follow-up