# Authoring a discoverable OpenAPI spec

A guide for **service owners** publishing a paid x402 / MPP HTTP API. OASIS ingests your
published OpenAPI spec, embeds each operation's text, binds it to a task capability, and ranks
it against sibling endpoints by how well it matches an agent's natural-language query. **How you
write the spec decides whether your endpoints get found.**

This is the spec-authoring "how"; for binding endpoints into the task ontology see
[contributing-capabilities.md](contributing-capabilities.md), and for the pipeline that consumes
your spec see [../ARCHITECTURE.md](../ARCHITECTURE.md).

## How OASIS reads your spec (so the rules make sense)

1. **Fetch** — your `/openapi.json` is fetched on a crawl.
2. **Gate** — each operation passes a quality gate or is dropped. An operation with no real
   summary, a synthesized `METHOD /path` stub, or **content-free boilerplate** is dropped — it
   never enters the index.
3. **Embed + bind** — the operation's *text* (summary + description + path + input names, with
   billing boilerplate stripped) is embedded and matched to a task capability. Vague or diluted
   text binds weakly or not at all.
4. **Rank** — for a query, candidate endpoints are ordered by semantic similarity of that text
   to the query. **Two endpoints that do the same task are separated by how precisely their text
   describes it.**

So your summary/description is not marketing copy and not dead metadata — it is the input to a
similarity search. Write it for that.

---

## The rules

### 1. Serve OpenAPI 3.1 JSON at `/openapi.json`, publicly
Reachable without auth, reasonably fast, modest size. JSON (not YAML-only). This is the
discovery convention agents and crawlers expect.

### 2. Give every operation a specific, capability-first `summary`
This is the single most important field. Lead with **what the agent gets**, in the words an
agent would use for the task.

- ✅ `Search Reddit posts and comments by keyword; returns score, author, subreddit, timestamp`
- ❌ `Social data tool` · ❌ `Premium API access` · ❌ `Endpoint`

Be concrete — name the thing returned. A summary an agent could match a real task against will
be found; a generic one won't.

### 3. One distinct summary per operation — never templated boilerplate
Don't stamp the **same** summary across your whole catalog. Identical, content-free summaries
(`"Premium API access"`, `"API endpoint"`, a bare price string) carry zero capability signal:
they fail the quality gate and are dropped, and even if they passed they'd be unrankable —
every operation would look identical to the embedder. If two operations differ, their summaries
must differ in the words that describe what they do.

### 4. Keep the summary focused — don't dilute the capability
Extra, peripheral vocabulary pulls your embedding *away* from the core task, so a more focused
competitor outranks you for the same query. Describe the capability, then stop.

- ✅ `Get a Reddit post with its comment thread`
- ❌ `Unlimited web-scraping framework actor to crawl posts, comments, communities, users, and
  more — limit by items, run as a job, poll for results …`

Both scrape Reddit, but the second buries "posts and comments" under framework/tooling words
("framework", "actor", "job", "items", "poll") and ranks lower for *"get reddit comments."*
Lead with the task; mention mechanics only if essential, and briefly.

### 5. Keep billing, mechanics, and brand names OUT of the summary
Price, `pay per result`, `x402`, `no API key required`, `without login`, the vendor/product
name — none of it describes the capability, and OASIS strips known billing boilerplate before
embedding anyway, so it's wasted (often harmful) text. Price and rails are captured as
**structured fields** (below), where they belong. The summary should read like a capability,
not a pitch or a how-to-call note.

### 6. Declare payment with the discovery standard
On every paid operation:
- **`x-payment-info`** with an `offers[]` array (the `draft-payment-discovery-00` shape): each
  offer's `intent` (`charge` / `session`), `method`, `amount`, and `currency`.
- A **`402`** response declared on the operation.
- **`x-service-info`** at the spec root (categories, docs/homepage links).

This is what lets OASIS price and rail your endpoint correctly. Endpoints with no parseable
price or non-standard payment metadata carry a ranking flag and lose to ones that declare it
cleanly.

### 7. Provide typed request and response schemas
Real `parameters` / `requestBody` schemas — names, types, descriptions, `required[]` — and at
least a `200` response schema. Typed I/O raises your **completeness score** (a ranking signal)
and is what lets agents chain your endpoint into a workflow. Name-only inputs are weak; no
schema is weaker.

### 8. Fill the cheap signals: `operationId`, `tags`, `info.description`
Each is a small, free completeness gain and adds vocabulary the binder can use. There's no
downside to having them.

---

## Checklist

- [ ] `/openapi.json` — OpenAPI 3.1 **JSON**, public, fast, modest size
- [ ] Every operation has a **distinct, specific, capability-first** `summary`
- [ ] **No** duplicated/boilerplate summaries; **no** price/brand/mechanics in the summary
- [ ] Summary is **focused** — capability first, no framework/tooling dilution
- [ ] `x-payment-info.offers` + a `402` response + root `x-service-info`
- [ ] Typed request schema (`required[]`) + a `200` response schema
- [ ] `operationId`, `tags`, `info.title`/`description`

## The one-line version

> OASIS ranks endpoints by how well their text matches the task. Write each operation's summary
> as the **specific capability an agent would ask for** — distinct per operation, focused, and
> free of billing/brand/boilerplate — and declare price + types as structured fields, not prose.
