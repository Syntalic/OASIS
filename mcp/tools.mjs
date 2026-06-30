// Shared OASIS tool definitions + handlers, used by both the MCP server
// (server.mjs) and the automated agent probe (probe.mjs). Wraps the built OASIS
// dist — hybrid discovery + query-aware resolve — as two agent-facing tools.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchHybridWithFallback } from "../dist/search/search-hybrid.js";
import { resolveEndpointsForQuery } from "../dist/bind/select-policy.js";
import { loadEndpointArm, endpointKey } from "../dist/bind/endpoint-arm.js";
import { embedText } from "../dist/embed/embedder.js";
import { relatedOptions } from "../dist/search/related.js";
import { loadEntityFlowRuntime, suggestFollowUps } from "../dist/entity/entity-flow-traverse.js";
import { extractEntities } from "../dist/entity/entity-extract.js";
import { curatedCapabilitiesForSearch } from "../dist/search/curated-search.js";
import { defaultLanceDir } from "../dist/embed/lance-index.js";
import { getTaxonomy } from "../dist/ontology/taxonomy.js";
import { validateSourceIntent } from "../dist/ontology/validate-source.js";
import { validateBinding } from "../dist/bind/binding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "..", "dist");

const bundle = JSON.parse(readFileSync(path.join(DIST, "index.json"), "utf8"));
// OASIS_GATE=1 — spec-completeness quality bar: drop endpoints with NO real published surface
// (no declared 200, no captured inputs) — the thin aggregator-only rows that
// pollute rank-1 (e.g. billboard "Get Price"). Env-gated to A/B the precision/distinct tradeoff.
if (process.env.OASIS_GATE === "1") {
  const before = bundle.endpoints.length;
  const specComplete = (e) =>
    (e.responses && e.responses.has200) || (e.inputs && e.inputs.length);
  bundle.endpoints = bundle.endpoints.filter(specComplete);
  console.error(`[oasis] GATE on: ${before} → ${bundle.endpoints.length} endpoints (dropped ${before - bundle.endpoints.length} thin)`);
}
const lanceDir = defaultLanceDir(DIST);
const curatedCaps = curatedCapabilitiesForSearch(bundle);
const capById = new Map(curatedCaps.map((c) => [c.id, c]));

let entityFlowRuntime = null;
async function getEntityFlowRuntime() {
  if (entityFlowRuntime) return entityFlowRuntime;
  try {
    entityFlowRuntime = await loadEntityFlowRuntime(DIST, curatedCaps);
    return entityFlowRuntime;
  } catch {
    return null;
  }
}

// Direct endpoint-embedding arm — a confidence-GATED fallback consulted only when the
// router is unsure (see oasisFind). Reuses the build-time endpoint-vector cache; reports
// notReady() (→ pure concentration) when the cache is absent, so this is safe before the
// vectors ship. The routing-margin threshold below which the arm takes over is tunable.
const endpointArm = loadEndpointArm(DIST, bundle.endpoints);
// The arm fires when (1) the router was a near-tie — top-two intents within MARGIN_GATE —
// OR (2) the router was moderately unsure (margin < ARM_CONSIDER_MARGIN) AND the arm finds
// an endpoint whose query-cosine beats concentration's best by ARM_BEATS_DELTA. (1) catches
// routing mis-picks (whois, onchain); (2) catches mis-bindings the margin alone misses
// (domain_register, social_data) without disturbing the working low-margin routes.
const MARGIN_GATE = Number(process.env.OASIS_MARGIN_GATE ?? "0.011");
const ARM_CONSIDER_MARGIN = Number(process.env.OASIS_ARM_CONSIDER ?? "0.05");
const ARM_BEATS_DELTA = Number(process.env.OASIS_ARM_BEATS ?? "0.08");
// Conditional semantic rerank of the concentrated top bucket (see select-policy semanticRescue).
// On = weight>0 AND the endpoint vectors loaded. Reuses the live query embedding (memoized below).
const SEMRANK_ON = Number(process.env.OASIS_SEMRANK_WEIGHT ?? "60") > 0;
// The endpoint arm ranks by pure query↔endpoint cosine, BYPASSING select-policy — so its
// rank-1 can be a catch-all (agentutility, breadth 53) or a thin row (billboard "Get Price").
// Apply the SAME quality signals here: drop thin (no 200/inputs) when gated, and a
// cosine-scale breadth penalty so specialists beat mega-host catch-alls. Env-gated for A/B.
const ARM_BREADTH = Number(process.env.OASIS_ARM_BREADTH ?? "0");
const armThin = (ep) => !((ep.responses && ep.responses.has200) || (ep.inputs && ep.inputs.length));
function armRerank(hits) {
  // Always drop thin/no-spec rows from the arm — it ranks by pure cosine and otherwise surfaces
  // contentless endpoints (billboard "Get Price", "Send feedback to a human") above real specialists.
  let h = hits.filter((a) => !armThin(a.ep));
  if (ARM_BREADTH > 0) {
    h = [...h]
      .map((a) => ({ ...a, score: a.score - ARM_BREADTH * Math.max(0, (a.ep.host_breadth ?? 0) - 12) }))
      .sort((x, y) => y.score - x.score);
  }
  return h;
}
if (endpointArm.ready) {
  console.error(`[oasis] endpoint arm ready (${endpointArm.size} endpoints, ${endpointArm.source}); gate: margin<${MARGIN_GATE} or (margin<${ARM_CONSIDER_MARGIN} & arm beats conc by ${ARM_BEATS_DELTA})`);
}

// The PUBLIC tool surface: 1 core (oasis_discover) + 3 utilities (search/taxonomy/validate). Derived into
// MCP / Anthropic / OpenAI shapes below. oasis_find / oasis_next / oasis_resolve / oasis_validate_binding
// remain in handleTool as deprecated aliases but are intentionally NOT exposed here. See
// docs/proposals/oasis-discover.md.
const ENTITY_ITEMS = {
  type: "object",
  properties: {
    entity: { type: "string" },
    value: { type: "string" },
    kind: { type: "string", enum: ["identity", "observation"] },
    role: { type: "string", enum: ["identifier", "payload"] },
  },
  required: ["entity"],
};
const TOOLS = [
  {
    name: "oasis_discover",
    description:
      "Find the paid HTTP API endpoints for a task — and what to do next — in ONE call. Returns `endpoints` (a ranked, host-deduped list: method, url, summary, price_usd, rails) plus `next_steps` — adjacent and cross-domain capabilities to chain into, each with a `why` and, where available, a callable endpoint. Start here whenever you're unsure which API to call.\n\nFor a multi-step task, run a loop: (1) call discover with your task as `query`; (2) invoke one of the returned endpoints; (3) call discover again with `finding` set to a plain-text note of what you just learned (e.g. \"registered acme.com for Acme Corp\") — it extracts the entities you now hold and folds cross-domain follow-ups into `next_steps`. Only `query` is needed on the first call; add `finding` on every follow-up.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The task in natural language." },
        finding: { type: "string", description: "What you just learned from the last endpoint you called — plain text; pass it on every follow-up call to get cross-domain next steps about what you now hold." },
        entities: { type: "array", description: "Typed entities you hold (structured alternative to `finding`, for programmatic callers).", items: ENTITY_ITEMS },
        limit: { type: "number", description: "Max endpoints (default 12)." },
      },
      required: ["query"],
    },
  },
  {
    name: "oasis_search",
    description:
      "Utility: classify a natural-language task to its OASIS capability intents (the task-type) — routing/introspection only, NO endpoint resolution. Returns ranked capability intents. Use `oasis_discover` to actually find endpoints; reach for this only when you want the classification itself (routing, analytics, categorizing a query).",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The task in natural language." },
        limit: { type: "number", description: "Max results (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "oasis_taxonomy",
    description:
      "Utility: return the OASIS controlled vocabulary to bind a service INTO — existing task capabilities (+aliases), facet enums (domain/action/modality/freshness), and the closed entity vocab. Call before authoring or updating a capability.",
    schema: { type: "object", properties: {} },
  },
  {
    name: "oasis_validate",
    description:
      "Utility: validate a contribution against the taxonomy — either a task-intent capability (`intent`) or an endpoint→capability binding (`binding`). Returns { valid, errors, warnings }. The SAME checks CI runs on the PR.",
    schema: {
      type: "object",
      properties: {
        intent: { type: "object", description: "A capability intent object to validate." },
        binding: { type: "object", description: "A service binding: { bindings: [{ origin, method, path, capabilities }] }." },
      },
    },
  },
];

// Arm-derived routing (OASIS_ARM_ROUTING=1): the robust query→ENDPOINT arm disambiguates homonyms the
// thin query→INTENT match can't ("place an AI phone call" → voice_call, NOT blockchain_rpc whose LABEL
// is "Call blockchain JSON RPC"). Read the intents the arm's top endpoints BIND to, then RRF-fuse with
// the hybrid caps — arm-derived as the precision primary (×2), hybrid for recall on oblique queries.
// Returns a ranked list of intent_ids. See docs/proposals/unified-find.md.
function armDerivedRouting(armHits, hybridCapIds, k = 12) {
  // Thin endpoints (no documented 200, no inputs) are stubs — their BINDINGS are unreliable, the very
  // noise that lets "book a flight" pick up a book-metadata endpoint from the deep tail. Tally only the
  // substantive top endpoints (the clean signal the arm-routing proof used).
  const thin = (ep) => !((ep.responses && ep.responses.has200) || (ep.inputs && ep.inputs.length));
  const armScore = new Map();
  armHits.filter((h) => !thin(h.ep)).slice(0, 8).forEach((h, rank) => {
    for (const c of (h.ep.capabilities ?? [])) armScore.set(c, (armScore.get(c) ?? 0) + 1 / (rank + 1));
  });
  const armRanked = [...armScore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const K0 = 60, fused = new Map();
  armRanked.forEach((id, r) => fused.set(id, (fused.get(id) ?? 0) + 2 / (K0 + r)));    // precision primary
  hybridCapIds.forEach((id, r) => fused.set(id, (fused.get(id) ?? 0) + 1 / (K0 + r))); // recall
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, k);
}

// Per-intent magnitude of arm support: Σ 1/(rank+1) over the substantive top-8 arm endpoints bound to
// each intent. The clean signal — stubs (thin) excluded — used by both the router and the guard.
function armSupportScores(armHits) {
  const thin = (ep) => !((ep.responses && ep.responses.has200) || (ep.inputs && ep.inputs.length));
  const s = new Map();
  armHits.filter((h) => !thin(h.ep)).slice(0, 8).forEach((h, rank) => {
    for (const c of (h.ep.capabilities ?? [])) s.set(c, (s.get(c) ?? 0) + 1 / (rank + 1));
  });
  return s;
}

// Surgical homonym GUARD (OASIS_ARM_GUARD=1): keep hybrid routing as-is, override its #1 ONLY when the
// arm FLATLY rejects it — hybrid's #1 has zero support among the arm's clean top-8 endpoints, the arm
// instead strongly backs a different intent (its #1 endpoint binds to it), and that intent is already a
// hybrid candidate. Catches "book a flight"→book_lookup / homonym noise without disturbing on-task #1s.
function armGuard(armHits, hybridOrder) {
  if (hybridOrder.length < 2) return hybridOrder;
  const sc = armSupportScores(armHits);
  const armTop = [...sc.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!armTop) return hybridOrder;
  const [armTopId, armTopVal] = armTop;
  const h1 = hybridOrder[0];
  if ((sc.get(h1) ?? 0) === 0 && armTopVal >= 1.0 && armTopId !== h1 && hybridOrder.includes(armTopId)) {
    return [armTopId, ...hybridOrder.filter((id) => id !== armTopId)];
  }
  return hybridOrder;
}

async function oasisSearch({ query, limit = 8 }) {
  if (!query || !String(query).trim()) return { error: "query is required" };
  const hits = await searchHybridWithFallback(query, bundle, lanceDir, Math.max(limit, 12));
  const capHits = hits.filter((h) => h.kind === "capability");
  let order = capHits.map((h) => h.capability_id);
  // Homonym guard is ON by default (validated +2/broke-0 on the 240; set OASIS_ARM_GUARD=0 to disable).
  // OASIS_ARM_ROUTING=1 is the experimental full arm-derived router (net −8 on the 240 — kept for A/B,
  // not shipped). See docs/proposals/unified-find.md.
  const routeOn = process.env.OASIS_ARM_ROUTING === "1";
  const guardOn = process.env.OASIS_ARM_GUARD !== "0";
  if ((routeOn || guardOn) && endpointArm.ready) {
    const armHits = armRerank(endpointArm.topK(await embedText(query), 40));
    order = routeOn ? armDerivedRouting(armHits, order, limit) : armGuard(armHits, order);
  }
  const capabilities = order.slice(0, limit).map((id) => {
    const h = capHits.find((x) => x.capability_id === id), c = capById.get(id);
    return (h || c) ? { intent_id: id, label: h?.label ?? c?.label, summary: h?.summary ?? c?.summary } : null;
  }).filter(Boolean);
  const endpoints = hits
    .filter((h) => h.kind === "endpoint")
    .slice(0, 3)
    .map((h) => ({ intent_id: h.capability_id, summary: h.label, target: `${h.method} ${h.origin}${h.path}`, price_usd: h.price_usd }));
  return { capabilities, endpoints };
}

function oasisResolve({ intent_id, query, limit = 8 }) {
  const intent = capById.get(intent_id);
  if (!intent) return { error: `unknown intent_id: ${intent_id}` };
  const endpoints = resolveEndpointsForQuery(intent, bundle.endpoints, query, limit).map(
    (e) => ({
      method: e.method,
      target: `${e.origin}${e.path}`,
      summary: e.summary,
      price_usd: e.payment?.price_usd,
      inputs: (e.inputs ?? []).slice(0, 8),
      rails: (e.payment?.rails ?? []).map((r) => r.protocol),
    }),
  );
  const related = relatedOptions(intent, bundle).map((r) => ({
    relation: r.relation_label,
    intent_id: r.intent_id,
    label: r.label,
  }));
  return { intent: { id: intent.id, label: intent.label }, endpoints, related };
}

// Unified next_steps for oasis_find: the data-driven entity-flow CLUSTER (everything that consumes an
// entity the task involves — Place=Japan → weather/reviews/places — with LOOSE caps + act-steps
// included) UNIONED with the curated authored links. Same entity-flow engine as oasis_next, but
// cluster-shaped instead of a-few-leads-shaped. See docs/proposals/unified-find.md.
// The unified "what's next" list. The FORWARD cluster is seeded from entities extracted from the QUERY
// (works on the first call — no held results). When the caller passes `held` (entities it now holds, from
// discover's finding/entities — i.e. call 2+), INVESTIGATIVE leads about what it holds are folded into the
// SAME list. One list out; `why` on each item carries the relationship. See docs/proposals/oasis-discover.md.
async function buildNextSteps(caps, query, held = null) {
  const topIntent = caps[0] ? capById.get(caps[0].capability_id) : null;
  if (!topIntent) return [];
  const toStep = (l) => ({ intent_id: l.intent_id, do: l.label, why: l.why,
    endpoint: l.top_endpoint ? `${l.top_endpoint.method} ${l.top_endpoint.origin}${l.top_endpoint.path}` : undefined,
    price_usd: l.top_endpoint?.price_usd });
  let cluster = [], heldLeads = [];
  const runtime = await getEntityFlowRuntime();
  if (runtime) {
    const topicalScores = new Map(caps.map((c) => [c.capability_id, c.score]));
    // forward cluster — entities extracted from the QUERY; fall back to the routed intent's consumed TYPES
    const extraction = extractEntities({ finding: query, source_intent_id: topIntent.id, bundle, capabilitiesById: capById });
    let qHeld = (extraction.entities ?? []).filter((e) => e.kind !== "observation");
    if (!qHeld.length) qHeld = (topIntent.consumes ?? []).map((c) => ({ entity: c.entity, kind: "identity", role: c.role }));
    if (qHeld.length) {
      const r = suggestFollowUps(
        { source_intent_id: topIntent.id, entities: qHeld, finding: query },
        runtime,
        { capabilities: curatedCaps, endpoints: bundle.endpoints, topicalScores, limit: 8,
          shape: { perEntityCap: 99, perDomainCap: 99, relevanceFloor: 0.25, includeAct: true } },
      );
      cluster = (r.investigative ?? []).map(toStep);
    }
    // investigative leads — what consumes the identity the agent now HOLDS (discover call 2+ only)
    if (held && held.length) {
      const r2 = suggestFollowUps(
        { source_intent_id: topIntent.id, entities: held, exclude: [topIntent.id], finding: query },
        runtime,
        { capabilities: curatedCaps, endpoints: bundle.endpoints, topicalScores, limit: 8 },
      );
      heldLeads = (r2.investigative ?? []).map(toStep);
    }
  }
  const rel = legacyRelatedGroups(topIntent);
  const links = [...rel.next_steps, ...rel.alternatives, ...rel.drill_down]
    .map((s) => ({ intent_id: s.intent_id, do: s.label, why: s.why, endpoint: s.endpoint, price_usd: s.price_usd }));
  // held-leads first (specific to what you hold), then the forward cluster, then curated links; dedup, cap
  const cap = held && held.length ? 8 : 6;
  const out = []; const seen = new Set([topIntent.id]);
  for (const s of [...heldLeads, ...cluster, ...links]) { if (!s.intent_id || seen.has(s.intent_id)) continue; seen.add(s.intent_id); out.push(s); if (out.length >= cap) break; }
  return out;
}

// One-hop prototype: collapse search→resolve SERVER-side. Hybrid discovery (capability
// vectors give recall on oblique queries) is expanded into a single FLAT, ranked endpoint
// list with payment metadata inline, PLUS a next_steps map (buildNextSteps) — the agent
// makes ONE call and gets "here's an endpoint, and here's what you can do next".
async function oasisDiscover({ query, finding, entities, limit = 12 }) {
  if (!query || !String(query).trim()) return { error: "query is required" };
  const hits = await searchHybridWithFallback(query, bundle, lanceDir, 12);
  // The query embedding is the ONE live model call (memoized) — shared by the semantic
  // rerank, the gated arm, and condfuse so no path embeds the query twice.
  let _qv = null;
  const getQueryVec = async () => (_qv ??= await embedText(query));
  // Conditional semantic rescue for the concentrated top bucket: precompute the cosine lookup
  // once (sync, over in-memory endpoint vectors) so resolveEndpointsForQuery can call it per ep.
  let semanticOf;
  if (SEMRANK_ON && endpointArm.ready) {
    const sv = await getQueryVec();
    semanticOf = (ep) => endpointArm.cosineToEndpoint(sv, endpointKey(ep)) ?? 0;
  }
  const out = [];
  const seen = new Set();
  const add = (method, origin, path, summary, price_usd, rails, via) => {
    const k = `${method} ${origin}${path}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ method, url: `${origin}${path}`, summary, price_usd, rails, via });
  };
  for (const h of hits) {
    if (h.kind === "endpoint") add(h.method, h.origin, h.path, h.label, h.price_usd, undefined, "match");
  }
  // Concentrate on the TOP-routed intent — return many of ITS providers — and pull only
  // a couple from each subsequent intent as a fallback (mainly when the top is thin).
  // Resolving 3 from every routed intent padded the list with adjacent-capability
  // endpoints, diluting precision (dogfooding tail-drift: ~38% vs ~72%).
  // For the top intent, prefer one endpoint per DISTINCT host first, so the flat list
  // maximizes distinct relevant providers instead of stacking several paths on one host.
  const caps = hits.filter((h) => h.kind === "capability");
  const hostOf = (origin) => origin.replace(/^https?:\/\//, "").split("/")[0];
  // Build concentration (out) — its #1 is the intent-path's pick, pinned below when routing is confident.
  caps.forEach((h, i) => {
    if (out.length >= limit) return;
    const intent = capById.get(h.capability_id);
    if (!intent) return;
    // Semantic rescue applies to the concentrated top bucket only — where the rank-1 gap lives.
    const pool = resolveEndpointsForQuery(intent, bundle.endpoints, query, i === 0 ? limit * 3 : 4, i === 0 ? semanticOf : undefined);
    const addEp = (e) =>
      add(e.method, e.origin, e.path, e.summary, e.payment?.price_usd, (e.payment?.rails ?? []).map((r) => r.protocol), h.capability_id);
    if (i === 0) {
      const seenHost = new Set();
      for (const e of pool) { if (out.length >= limit) break; const ho = hostOf(e.origin); if (seenHost.has(ho)) continue; seenHost.add(ho); addEp(e); }
      for (const e of pool) { if (out.length >= limit) break; addEp(e); } // fill remaining (allow same-host)
    } else {
      for (const e of pool.slice(0, 2)) { if (out.length >= limit) break; addEp(e); }
    }
  });
  // ── UNIFIED FIND: the query→endpoint vector ARM is the base — pure query-first retrieval, which
  // scores ~80% P@1 (vs ~69% for the old intent-first concentration and ~78% for a vector-search baseline). A confident
  // intent-#1 "pin" to recover the ~17 moat cases the arm distracts on (e.g. "voice"→TTS not a
  // script-writer) was tried but regressed more than it recovered (net −23/240 — even with arm
  // corroboration), so the base is pure arm; moat recovery needs a smarter fusion (TODO —
  // docs/proposals/unified-find.md). Degrades to concentration when the vector cache is absent.
  let endpoints;
  let routedCaps = caps; // hybrid order; guarded below when the arm is available
  if (endpointArm.ready) {
    const qv = await getQueryVec();
    const armHits = armRerank(endpointArm.topK(qv, limit * 8));
    const list = [];
    const sh = new Set();
    const push = (e) => { const ho = hostOf(e.url); if (sh.has(ho) || list.some((x) => x.url === e.url)) return; sh.add(ho); list.push(e); };
    const armEp = (a) => ({ method: a.ep.method, url: `${a.ep.origin}${a.ep.path}`, summary: a.ep.summary, price_usd: a.ep.payment?.price_usd, rails: (a.ep.payment?.rails ?? []).map((r) => r.protocol), via: "arm" });
    for (const a of armHits) { if (list.length >= limit) break; push(armEp(a)); }
    for (const a of armHits) { if (list.length >= limit) break; const e = armEp(a); if (!list.some((x) => x.url === e.url)) list.push(e); } // same-host backfill if short
    endpoints = list.slice(0, limit);
    // Seed next_steps from the GUARDED top intent (default-on): when the arm flatly rejects hybrid's #1
    // (a homonym), reorder so the cluster grows from the right capability. Reuses these arm hits.
    if (process.env.OASIS_ARM_GUARD !== "0") {
      const ordered = armGuard(armHits, caps.map((c) => c.capability_id));
      routedCaps = ordered.map((id) => caps.find((c) => c.capability_id === id)).filter(Boolean);
    }
  } else {
    endpoints = out.slice(0, limit); // no vectors → concentration
  }
  // next_steps: the "what can you do next" map a pure-vector engine can't return — the entity-flow CLUSTER
  // from the QUERY (e.g. Place=Japan → weather/reviews/places) + curated links, plus (when the caller passes
  // finding/entities, i.e. call 2+) investigative leads about what it now HOLDS.
  let held = null;
  if ((finding && String(finding).trim()) || (Array.isArray(entities) && entities.length)) {
    const ex = extractEntities({ finding, explicitEntities: entities, source_intent_id: routedCaps[0]?.capability_id, bundle, capabilitiesById: capById });
    held = (ex.entities ?? []).filter((e) => e.kind !== "observation");
  }
  const next_steps = await buildNextSteps(routedCaps, query, held);
  // matched_capabilities: the routing signal (what oasis_search returns) as a field — no separate call needed.
  const matched_capabilities = routedCaps.slice(0, 8)
    .map((c) => { const cap = capById.get(c.capability_id); return cap ? { intent_id: c.capability_id, label: cap.label } : null; })
    .filter(Boolean);
  return { endpoints, next_steps, matched_capabilities };
}

// oasis_find is a deprecated alias retained for back-compat; oasis_discover supersedes it (+ oasis_next).
async function oasisFind(args) {
  const { endpoints, next_steps } = await oasisDiscover(args ?? {});
  return { endpoints, next_steps };
}

function fmtFollowUp(lead) {
  return {
    intent_id: lead.intent_id,
    label: lead.label,
    bridging_entity: lead.bridging_entity,
    match_kind: lead.match_kind,
    why: lead.why,
    score: lead.score,
    forward: [],
    endpoint: lead.top_endpoint
      ? {
          method: lead.top_endpoint.method,
          url: `${lead.top_endpoint.origin}${lead.top_endpoint.path}`,
          price_usd: lead.top_endpoint.price_usd,
          rails: lead.top_endpoint.rails,
        }
      : undefined,
  };
}

function legacyRelatedGroups(intent) {
  const options = relatedOptions(intent, bundle).slice(0, 12);
  const fmt = (o) => ({
    intent_id: o.intent_id,
    label: o.label,
    why: o.note,
    endpoint: o.top_endpoint
      ? `${o.top_endpoint.method} ${o.top_endpoint.origin}${o.top_endpoint.path}`
      : undefined,
    price_usd: o.top_endpoint?.price_usd,
  });
  const byRel = (rels) => options.filter((o) => rels.includes(o.relation)).map(fmt);
  return {
    next_steps: byRel(["pipes_to"]),
    drill_down: byRel(["broader_of"]),
    generalize: byRel(["narrower_of"]),
    alternatives: byRel(["alternative_of", "sibling_of"]),
    prior_steps: byRel(["fed_by"]),
  };
}

// oasis_next v1: cross-domain investigative leads from held identity entities.
async function oasisNext({
  finding,
  entities: explicitEntities,
  intent_id,
  query,
  exclude_intent_ids = [],
  limit = 8,
} = {}) {
  const runtime = await getEntityFlowRuntime();
  if (!runtime) {
    if (intent_id || query) {
      let intent;
      if (intent_id) {
        intent = capById.get(intent_id);
        if (!intent) return { error: `unknown intent_id: ${intent_id}` };
      } else {
        const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
        const top = hits.find((h) => h.kind === "capability");
        if (!top) return { error: "no capability matched the query" };
        intent = capById.get(top.capability_id);
      }
      const legacy = legacyRelatedGroups(intent);
      return {
        source: { intent_id: intent.id, label: intent.label },
        forward: [],
        investigative: [],
        entity_context: { method: "legacy_fallback", held: [] },
        ...legacy,
        hint: "entity-flow index not built — rebuild with pnpm run build",
      };
    }
    return { error: "entity-flow index not available — run pnpm run build" };
  }

  let source_intent_id = intent_id;
  if (!source_intent_id && query) {
    const hits = await searchHybridWithFallback(query, bundle, lanceDir, 5);
    const top = hits.find((h) => h.kind === "capability");
    if (!top) return { error: "no capability matched the query" };
    source_intent_id = top.capability_id;
  }

  const extraction = extractEntities({
    finding,
    explicitEntities,
    source_intent_id,
    bundle,
    capabilitiesById: capById,
  });

  if (!extraction.entities.length) {
    return {
      error: "no entities held — pass entities[] or a finding with extractable typed nouns",
    };
  }

  const source = source_intent_id ? capById.get(source_intent_id) : undefined;

  // Topical relevance of the finding → intents: reuse oasis_find's hybrid search over the SAME
  // intent vectors, so oasis_next ranks bridges by relevance to the finding, not just by type.
  let topicalScores;
  const topicalText = finding || query;
  if (topicalText) {
    const hits = await searchHybridWithFallback(topicalText, bundle, lanceDir, 200);
    topicalScores = new Map();
    for (const h of hits) {
      if (h.kind === "capability" && !topicalScores.has(h.capability_id)) {
        topicalScores.set(h.capability_id, h.score);
      }
    }
  }

  const result = suggestFollowUps(
    {
      source_intent_id,
      entities: extraction.entities,
      exclude: exclude_intent_ids,
      finding,
    },
    runtime,
    { limit, capabilities: curatedCaps, endpoints: bundle.endpoints, topicalScores },
  );

  const out = {
    source: source ? { intent_id: source.id, label: source.label } : undefined,
    entity_context: { method: extraction.method, held: extraction.entities },
    forward: [],
    forward_note: "v2 — forward (process-output chaining) is always [] in v1",
    investigative: result.investigative.map(fmtFollowUp),
  };

  if (!out.investigative.length && extraction.entities.some((e) => e.kind === "observation")) {
    out.hint = "pass identity entities (e.g. Place, Company) for cross-domain leads";
  }

  if (process.env.OASIS_NEXT_LEGACY === "1" && source) {
    Object.assign(out, legacyRelatedGroups(source));
  }

  return out;
}

export async function handleTool(name, args) {
  // Public surface: 1 core + 3 utilities.
  if (name === "oasis_discover") return oasisDiscover(args ?? {});
  if (name === "oasis_search") return oasisSearch(args ?? {});
  if (name === "oasis_taxonomy") return getTaxonomy();
  if (name === "oasis_validate") {
    // accepts either a capability intent ({intent}) or an endpoint→capability binding ({binding})
    if (args?.binding) return validateBinding(args.binding, bundle.endpoints);
    return validateSourceIntent(args?.intent ?? args ?? {});
  }
  // Deprecated aliases — superseded by oasis_discover / oasis_validate; still routed for back-compat.
  if (name === "oasis_find") return oasisFind(args ?? {});
  if (name === "oasis_next") return oasisNext(args ?? {});
  if (name === "oasis_resolve") return oasisResolve(args ?? {});
  if (name === "oasis_validate_binding") return validateBinding(args?.binding ?? args ?? {}, bundle.endpoints);
  return { error: `unknown tool: ${name}` };
}

/** The loaded index bundle + curated-capability lookup, for harnesses (compare.mjs). */
export { bundle, capById };

/** Anthropic Messages API tool shape ({ input_schema }). */
export const ANTHROPIC_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.schema,
}));

/** MCP tool shape ({ inputSchema }) — derived from the public surface (TOOLS): oasis_discover + the
 *  three utilities. The deprecated aliases (find/next/resolve/validate_binding) are routed by handleTool
 *  but intentionally not advertised here. */
export const MCP_TOOLS = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.schema,
}));

/** OpenAI Chat Completions tool shape ({ type:"function", function:{ parameters } }).
 *  Works with any OpenAI-compatible provider (OpenAI, OpenRouter, Together, Groq,
 *  Ollama, LM Studio, vLLM, ...). */
export const OPENAI_TOOLS = TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.schema },
}));
