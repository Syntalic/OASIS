// Production ingestion: federate discovery registries → dedup origins → enrich each
// origin's /openapi.json → gate → emit a clean IndexBundle (dist/index.json). The semantic
// binder (enrich-facets) runs next in the build to bind endpoints to intents + materialize.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { endpointId } from "../core/id.js";
import { baseUnitsToUsd, parseAmountHint } from "../core/money.js";
import { parseOpenApi } from "./openapi-parser.js";
import { canonicalOrigin } from "./origin-aliases.js";
import { gradeEndpoint } from "../bind/quality-gate.js";
import type { EndpointRecord, HttpMethod, IndexBundle, JsonSchema } from "../core/types.js";
import { bazaarToEndpoint, fetchBazaar } from "./bazaar.js";
import { fetchPayShProviders, payShOrigin } from "./paysh.js";
import { assembleSchemaStore, SchemaCollector } from "./schema-store.js";
import { safeFetch } from "./net-guard.js";
import {
  applyCircuitBreaker,
  probePaymentLiveness,
  type Verdict,
  type VerifyResult,
} from "./payment-verify.js";
import {
  isFresh,
  loadVerdictCache,
  pruneCache,
  saveVerdictCache,
  type CachedVerdict,
} from "./verdict-cache.js";

// AJV (CJS) via createRequire — same pattern as src/ingest/payment-spec.ts. Used to compile a
// provider's declared output schema into the `validateOutput` discriminator for the 2xx probe leg.
const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

const SPEC_VERSION = "0.4.0";
const INDEX_VERSION = "0.4.0";
const HTTP = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const hostOf = (origin: string): string => {
  try { return new URL(origin).hostname; } catch { return origin; }
};

interface MppEndpoint {
  method?: string;
  path?: string;
  summary?: string;
  description?: string;
  payment?: { amountHint?: string; amount?: string | number; decimals?: number; currency?: string };
}
interface MppService {
  id?: string;
  url?: string;
  serviceUrl?: string;
  description?: string;
  tags?: string[];
  endpoints?: MppEndpoint[];
}

export interface IngestOptions {
  outputDir: string;
  builtAt: string;
  /** Rebuild from a saved merged-record snapshot (JSON array or {endpoints}) — re-gates
   *  + writes the bundle WITHOUT any network crawl. Used to re-apply gate/binding changes
   *  to an existing crawl (the gate + binder are post-crawl transforms). */
  snapshotPath?: string;
  bazaarMaxPages?: number;
  enrichLimit?: number;
  enrichConcurrency?: number;
}

/** Gate a merged record set → IndexBundle, write index.json + endpoints.json, return it. */
async function gateAndWrite(merged: EndpointRecord[], outputDir: string, built: string): Promise<IndexBundle> {
  const passing = merged.filter((e) => gradeEndpoint(e).verdict === "pass");
  const passOrigins = new Set(passing.map((e) => e.origin));
  console.error(`ingest: ${merged.length} records → ${passing.length} PASS`);
  const bundle: IndexBundle = {
    index_version: INDEX_VERSION,
    spec_version: SPEC_VERSION,
    built_at: built,
    sources: [{ name: "federated-ingest", path: "discover", endpoints: passing.length }],
    stats: { providers: 0, endpoints: passing.length, capabilities: 0, origins: passOrigins.size },
    endpoints: passing,
    capabilities: [],
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.json"), JSON.stringify(bundle, null, 2));
  await writeFile(
    path.join(outputDir, "endpoints.json"),
    JSON.stringify({ index_version: INDEX_VERSION, spec_version: SPEC_VERSION, built_at: built, stats: bundle.stats, endpoints: passing }, null, 2),
  );
  return bundle;
}

/** Write the content-addressed schema map to `outputDir/schemas.json`. */
export async function writeSchemas(store: Record<string, JsonSchema>, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "schemas.json"), JSON.stringify(store, null, 2));
}

/** Strip ranking/debug substrate fields a snapshot may carry → clean EndpointRecord. */
function cleanRecord(r: Record<string, unknown>): EndpointRecord {
  const { _source, _completeness, _flags, _wellknown, ...rest } = r;
  return rest as unknown as EndpointRecord;
}

/**
 * Write dist/schemas.json = fresh schemas + the prior store carried forward, pruned to what the
 * endpoints still reference (so no schema ref dangles). Fail-soft on a missing/broken prior store.
 * Shared by the full crawl AND the no-crawl snapshot rebuild — the snapshot path previously skipped
 * this, so a reproduced index carried refs but no schemas.json (every ref dangled).
 */
async function writeSchemaStore(
  bundle: IndexBundle,
  freshStore: Record<string, JsonSchema>,
  outputDir: string,
): Promise<void> {
  let priorStore: Record<string, JsonSchema> = {};
  const priorSchemasPath = path.join(outputDir, "schemas.json");
  if (existsSync(priorSchemasPath)) {
    try { priorStore = JSON.parse(await readFile(priorSchemasPath, "utf8")) as Record<string, JsonSchema>; } catch {}
  }
  await writeSchemas(assembleSchemaStore(bundle.endpoints, freshStore, priorStore), outputDir);
}

export async function runIngest(opts: IngestOptions): Promise<IndexBundle> {
  const built = opts.builtAt;

  // No-crawl rebuild: re-gate a saved merged snapshot and re-emit the bundle. The gate and
  // the semantic binder (enrich-facets, run next) are post-crawl transforms, so re-applying
  // gate/floor changes needs no fresh network fetch.
  if (opts.snapshotPath) {
    const raw = JSON.parse(await readFile(opts.snapshotPath, "utf8")) as unknown;
    const recs = (Array.isArray(raw) ? raw : ((raw as { endpoints?: unknown[]; records?: unknown[] }).endpoints ?? (raw as { records?: unknown[] }).records ?? [])) as Record<string, unknown>[];
    console.error(`ingest: snapshot ${path.basename(opts.snapshotPath)} → ${recs.length} merged records (no crawl)`);
    const snap = await gateAndWrite(recs.map(cleanRecord), opts.outputDir, built);
    // Carry forward the prior schemas.json so the snapshot records' schema refs don't dangle.
    await writeSchemaStore(snap, {}, opts.outputDir);
    return snap;
  }

  const conc = opts.enrichConcurrency ?? 16;
  const schemaCollector = new SchemaCollector();
  const inlineByKey = new Map<string, EndpointRecord>();
  const originSource = new Map<string, string>();
  const addInline = (rec: EndpointRecord | null, src: string): void => {
    if (!rec) return;
    const k = `${rec.origin}|${rec.method}|${rec.path}`;
    if (!inlineByKey.has(k)) inlineByKey.set(k, rec);
    if (!originSource.has(rec.origin)) originSource.set(rec.origin, src);
  };

  // --- Discovery ---
  console.error("ingest: bazaar ...");
  const bz = await fetchBazaar({
    maxPages: opts.bazaarMaxPages,
    onProgress: (n, t) => { if (n % 5000 === 0) console.error(`  bazaar ${n}/${t}`); },
  });
  for (const r of bz) addInline(bazaarToEndpoint(r, built, schemaCollector), "bazaar");

  console.error("ingest: mpp.dev ...");
  let mppSvcs: MppService[] = [];
  try {
    const r = await fetch("https://mpp.dev/api/services");
    if (r.ok) mppSvcs = ((await r.json()) as { services?: MppService[] }).services ?? [];
  } catch {}
  for (const s of mppSvcs) {
    let origin: string;
    try { origin = canonicalOrigin(new URL(s.serviceUrl || s.url || "").origin); } catch { continue; }
    for (const e of s.endpoints ?? []) {
      const p = e.payment ?? {};
      const price = parseAmountHint(p.amountHint) ?? baseUnitsToUsd(p.amount, { decimals: p.decimals, currency: p.currency });
      const rawM = String(e.method ?? "POST").toUpperCase() as HttpMethod;
      const method = HTTP.has(rawM) ? rawM : "POST";
      const p2 = e.path || "/";
      addInline({
        id: endpointId(origin, method, p2), origin, method, path: p2,
        summary: String(e.summary || e.description || s.description || p2).slice(0, 200),
        description: e.description || s.description, tags: s.tags, provider_fqn: `mpp/${hostOf(origin)}`,
        payment: { paid: true, price_usd: price, rails: [{ protocol: "mpp" }], currency: p.currency },
        responses: { has402: true }, search_text: "", built_at: built,
      }, "mpp");
    }
    if (!(s.endpoints ?? []).length && !originSource.has(origin)) originSource.set(origin, "mpp");
  }

  console.error("ingest: pay.sh ...");
  for (const prov of await fetchPayShProviders()) {
    const o = payShOrigin(prov);
    if (o && !originSource.has(o)) originSource.set(o, "paysh");
  }

  // Read the prior index once — reused for the x402scan bootstrap (below) and carry-forward (at merge).
  let prior: IndexBundle | null = null;
  const priorPath = path.join(opts.outputDir, "index.json");
  if (existsSync(priorPath)) {
    try { prior = JSON.parse(await readFile(priorPath, "utf8")) as IndexBundle; } catch {}
  }
  // x402scan origins: bootstrap from the prior index (records tagged provider_fqn "x402scan/..."
  // below) so they get re-probed for fresh specs; carry-forward (at merge) covers any that don't reply.
  if (prior) {
    for (const e of prior.endpoints ?? []) {
      if ((e.provider_fqn || "").startsWith("x402scan") && !originSource.has(e.origin)) originSource.set(e.origin, "x402scan");
    }
  }

  const origins = [...originSource.keys()].slice(0, opts.enrichLimit);
  console.error(`ingest: ${originSource.size} unique origins, ${inlineByKey.size} inline records; enriching ${origins.length} (conc ${conc}) ...`);

  // Liveness skip: origins the health sidecar (dist/endpoint-health.json, built by scripts/build-health.mjs)
  // marks "dead" are NOT re-fetched — the openapi.json hop hangs the 10s timeout on them (measured ~5.25s
  // avg per dead origin; 39% time out fully). They fall through to carry-forward below (TTL-bounded), so
  // they're not lost and rejoin enrichment on their next live probe. Fail-soft: no sidecar → no skip.
  // Disable with OASIS_ENRICH_SKIP_DEAD=0.
  const deadOrigins = new Set<string>();
  if (process.env.OASIS_ENRICH_SKIP_DEAD !== "0") {
    try {
      const health = JSON.parse(await readFile(path.join(opts.outputDir, "endpoint-health.json"), "utf8")) as { hosts?: Record<string, { verdict?: string } | undefined> };
      for (const [h, r] of Object.entries(health.hosts ?? {})) if (r?.verdict === "dead") deadOrigins.add(h);
      if (deadOrigins.size) console.error(`  liveness skip: ${deadOrigins.size} dead origins won't be re-fetched (carry-forward covers them)`);
    } catch { /* no sidecar → no skip */ }
  }

  // --- Enrichment: hop /openapi.json per origin ---
  const enrichedByOrigin = new Map<string, EndpointRecord[]>();
  let i = 0, ok = 0, skipped = 0;
  const enrichOne = async (origin: string): Promise<void> => {
    if (deadOrigins.has(origin)) { skipped++; return; } // liveness-dead → skip the wasted fetch; carry-forward covers it
    try {
      const res = await safeFetch(`${origin}/openapi.json`, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
      if (!res.ok) return;
      const buf = await res.text();
      if (buf.length > 2_000_000) return;
      const { records: recs, schemas: sc } = parseOpenApi(JSON.parse(buf), { origin, builtAt: built });
      if (recs.length) { enrichedByOrigin.set(origin, recs); schemaCollector.merge(sc); ok++; }
    } catch {}
  };
  const worker = async (): Promise<void> => {
    while (i < origins.length) {
      const o = origins[i++];
      await enrichOne(o);
      if (i % 200 === 0) console.error(`  enrich ${i}/${origins.length} (served ${ok})`);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.error(`  enriched ${ok} origins${skipped ? `, skipped ${skipped} dead (liveness)` : ""}`);

  // --- Merge: openapi enrichment overrides registry inline per origin; tag discovery source ---
  let merged: EndpointRecord[] = [];
  for (const [origin, recs] of enrichedByOrigin) {
    const src = originSource.get(origin) ?? "openapi";
    for (const r of recs) {
      if (!r.provider_fqn) r.provider_fqn = `${src}/${hostOf(origin)}`;
      merged.push(r);
    }
  }
  for (const [, rec] of inlineByKey) if (!enrichedByOrigin.has(rec.origin)) merged.push(rec);

  // --- Carry forward: an origin in the prior index that didn't re-probe this run AND has no fresh
  // registry record would otherwise vanish — but a failed probe is usually transient (a serverless
  // cold-start past the 10s timeout, a blip), not a dead origin, so dropping it silently shrinks the
  // index every crawl. Re-add its prior endpoints, bounded by a staleness TTL (built_at = last good
  // probe) so genuinely-gone origins still age out. Disable with INGEST_NO_CARRY_FORWARD=1. ---
  if (prior && process.env.INGEST_NO_CARRY_FORWARD !== "1") {
    const staleDays = Number(process.env.INGEST_STALE_DAYS) || 30;
    // Liveness-confirmed-dead origins age out on a SHORTER window than merely-didn't-reply ones: a probe
    // blip is transient (30d grace), but a host the health sidecar has repeatedly marked dead is probably
    // gone, so reclaim its index footprint sooner. Still recoverable — a host that comes back inside the
    // window is re-probed live (build:health flips its verdict) before it's evicted. Tunable.
    const staleDaysDead = Number(process.env.INGEST_STALE_DAYS_DEAD) || 7;
    const ttlMs = staleDays * 86_400_000;
    const ttlDeadMs = staleDaysDead * 86_400_000;
    const nowMs = Date.parse(built);
    const have = new Set(merged.map((e) => e.origin));
    let carried = 0, evicted = 0, evictedDead = 0;
    for (const e of prior.endpoints ?? []) {
      if (have.has(e.origin)) continue; // origin already covered by a fresh probe / inline record
      const seen = Date.parse(e.built_at ?? "");
      const dead = deadOrigins.has(e.origin);
      const ttl = dead ? ttlDeadMs : ttlMs;
      if (Number.isFinite(seen) && Number.isFinite(nowMs) && nowMs - seen > ttl) { evicted++; if (dead) evictedDead++; continue; }
      merged.push(e);
      carried++;
    }
    console.error(`  carry-forward: +${carried} re-added; evicted ${evicted} stale (${evictedDead} liveness-dead > ${staleDaysDead}d, rest > ${staleDays}d)`);
  }

  // --- Live payment verification (crawl-path only; NEVER the snapshot rebuild) ---
  // Probe each claimed-paid endpoint unpaid, stamp payment_verified, apply the mass-drop
  // circuit-breaker. Membership is unchanged here — the gate drops `contradicted` records next.
  merged = await verifyPayments(merged, prior, opts.outputDir, built);

  // --- Gate → PASS corpus → bundle ---
  const bundle = await gateAndWrite(merged, opts.outputDir, built);
  // Persist a store covering EVERY schema ref on the written endpoints. This run's collector only
  await writeSchemaStore(bundle, schemaCollector.toObject(), opts.outputDir);
  return bundle;
}

// ---------------------------------------------------------------------------
// Live payment verification (Task 7)
// ---------------------------------------------------------------------------

/** Methods we never probe (mutation risk) — stamped `unknown` without a network hop. */
const NO_PROBE_METHODS = new Set<string>(["DELETE", "PUT", "PATCH"]);

/** Claimed-paid = the record asserts payment (paid flag OR at least one declared rail). */
function isClaimedPaid(e: EndpointRecord): boolean {
  return e.payment?.paid === true || (Array.isArray(e.payment?.rails) && e.payment.rails.length > 0);
}

/** Read `outputDir/schemas.json` (fail-soft `{}`) — the prior store; this run's is written post-gate. */
async function loadSchemaStore(outputDir: string): Promise<Record<string, JsonSchema>> {
  try {
    return JSON.parse(await readFile(path.join(outputDir, "schemas.json"), "utf8")) as Record<
      string,
      JsonSchema
    >;
  } catch {
    return {};
  }
}

/** Resolve `ep.output_schema_ref` → an Ajv validator (compiled once per ref, cached). Fail-soft:
 *  no ref / no schema / uncompilable → undefined (the classifier treats schema-less as inconclusive). */
/**
 * A schema with no power to tell a real paid response from an arbitrary benign JSON object — `{}`,
 * `true`, `{type:"object"}`, or any object schema with no non-empty `required` and
 * `additionalProperties` not `false`. It validates almost anything, so it cannot serve as the
 * affirmative-lie discriminator (leg d of classify2xx). Erring toward "permissive" is the SAFE
 * direction: a permissive schema DISABLES the drop discriminator (→ `unknown`), so a genuinely-paid
 * endpoint that answers the unpaid probe with a benign 200 (an auth gate / WAF returning
 * `{"authenticated":false}`, `{"success":false}`) is kept, not wrongly delisted. Composition/`$ref`/
 * `enum`/`const` schemas retain real discriminating power and are kept.
 */
export function isPermissiveSchema(schema: JsonSchema): boolean {
  const sc = schema as unknown;
  if (sc === true) return true;
  if (typeof sc !== "object" || sc === null) return true; // {}/boolean-false/non-object → no power
  const s = sc as Record<string, unknown>;
  if (Array.isArray(s.required) && s.required.length > 0) return false;
  if (s.additionalProperties === false) return false;
  if (s.oneOf || s.allOf || s.anyOf || s.$ref || s.enum !== undefined || s.const !== undefined) return false;
  return true; // no required + additionalProperties not false ⇒ validates any object
}

function makeValidatorResolver(
  schemaStore: Record<string, JsonSchema>,
): (ep: EndpointRecord) => ((b: unknown) => boolean) | undefined {
  const ajv = new Ajv({ strict: false, validateSchema: false, allErrors: false });
  addFormats(ajv);
  const cache = new Map<string, ((b: unknown) => boolean) | undefined>();
  return (ep) => {
    const ref = ep.output_schema_ref;
    if (!ref) return undefined;
    if (cache.has(ref)) return cache.get(ref);
    const schema = schemaStore[ref];
    let validate: ((b: unknown) => boolean) | undefined;
    // A permissive schema can't discriminate a lie — treat it as schema-less (→ `unknown`), never a drop.
    if (schema && !isPermissiveSchema(schema)) {
      try {
        const compiled = ajv.compile(schema);
        validate = (b: unknown) => compiled(b) === true;
      } catch {
        validate = undefined;
      }
    }
    cache.set(ref, validate);
    return validate;
  };
}

/**
 * Verify claimed-paid endpoints against live behaviour (crawl-path only).
 *
 * Stamps `payment_verified`/`payment_verified_at` (+ `payment.live_challenge` on `verified`) on every
 * record, applies the catalog-delta circuit-breaker, refreshes+prunes the verdict cache, and emits
 * metrics. Membership is unchanged — the caller's gate drops the `contradicted` verdict downstream.
 *
 * Scheduling is host-aware: probes run at a global concurrency (`PROBE_CONCURRENCY`, default 16) with
 * a per-host in-flight cap (`PROBE_PER_HOST`, default 2), round-robin across hosts so one slow/large
 * host cannot head-of-line-block the rest; a host is backed off after repeated 429/403.
 */
export async function verifyPayments(
  merged: EndpointRecord[],
  prior: IndexBundle | null,
  outputDir: string,
  built: string,
  deps: {
    probe?: typeof probePaymentLiveness;
    schemaStore?: Record<string, JsonSchema>;
    nowMs?: number;
  } = {},
): Promise<EndpointRecord[]> {
  // (1) Kill-switch — leave the corpus untouched (used for deterministic offline rebuilds/tests).
  if (process.env.INGEST_NO_VERIFY) return merged;

  const probe = deps.probe ?? probePaymentLiveness;
  const nowMs = deps.nowMs ?? Date.now();

  // (2) Load the verdict cache + the schema store (for the 2xx output-schema discriminator).
  const cache = await loadVerdictCache(outputDir);
  const schemaStore = deps.schemaStore ?? (await loadSchemaStore(outputDir));
  const resolveOutputValidator = makeValidatorResolver(schemaStore);

  // (3) Partition: not-paid / write-method → stamp unknown w/o probing; eligible w/ a fresh cached
  //     verdict → reuse (no probe); the rest → probe queue.
  const results = new Map<string, VerifyResult>(); // endpoint id → verdict
  const probedIds = new Set<string>();
  const seenIds = new Set<string>();
  const toProbe: EndpointRecord[] = [];
  // id → the ORIGINAL probe time for verdicts reused from a fresh cache hit. Freshly-determined
  // records get `built`; reused ones keep this so payment_verified_at doesn't lie about staleness.
  const reusedVerifiedAt = new Map<string, string>();

  for (const ep of merged) {
    seenIds.add(ep.id);
    if (!isClaimedPaid(ep)) {
      results.set(ep.id, { verdict: "unknown", reason: "not_paid" });
      continue;
    }
    if (NO_PROBE_METHODS.has(ep.method)) {
      results.set(ep.id, { verdict: "unknown", reason: "unprobed_write_method" });
      continue;
    }
    const cached = cache[ep.id];
    if (cached && isFresh(cached, nowMs)) {
      results.set(ep.id, { verdict: cached.verdict, reason: cached.reason, challenge: cached.challenge });
      reusedVerifiedAt.set(ep.id, cached.verified_at); // carry the original probe time through reuse
      continue; // reuse — do NOT probe
    }
    toProbe.push(ep);
  }

  // --- (3b) Host-aware scheduler over the probe queue ---
  const PROBE_CONCURRENCY = Number(process.env.PROBE_CONCURRENCY) || 16;
  const PROBE_PER_HOST = Number(process.env.PROBE_PER_HOST) || 2;
  const BACKOFF_THRESHOLD = 3; // consecutive 429/403 on a host → skip its remaining probes

  const byHost = new Map<string, EndpointRecord[]>();
  for (const ep of toProbe) {
    const h = hostOf(ep.origin);
    let arr = byHost.get(h);
    if (!arr) byHost.set(h, (arr = []));
    arr.push(ep);
  }
  const hosts = [...byHost.keys()];
  const cursor = new Map<string, number>(hosts.map((h) => [h, 0]));
  const inFlight = new Map<string, number>(hosts.map((h) => [h, 0]));
  const backoff = new Map<string, number>(hosts.map((h) => [h, 0]));
  let rr = 0;

  // Claim the next probe-able endpoint: round-robin across hosts, skipping exhausted / at-cap /
  // backed-off hosts. Returns null when nothing is claimable right now (caller yields + retries).
  const nextEndpoint = (): EndpointRecord | null => {
    for (let scan = 0; scan < hosts.length; scan++) {
      const hi = (rr + scan) % hosts.length;
      const h = hosts[hi];
      if ((backoff.get(h) ?? 0) >= BACKOFF_THRESHOLD) continue;
      const arr = byHost.get(h)!;
      const idx = cursor.get(h)!;
      if (idx >= arr.length) continue; // exhausted
      if ((inFlight.get(h) ?? 0) >= PROBE_PER_HOST) continue; // at per-host cap
      cursor.set(h, idx + 1);
      inFlight.set(h, (inFlight.get(h) ?? 0) + 1);
      rr = hi + 1;
      return arr[idx];
    }
    return null;
  };
  const remainingWork = (): boolean => {
    for (const h of hosts) {
      if ((backoff.get(h) ?? 0) >= BACKOFF_THRESHOLD) continue; // backed-off → no more work
      if (cursor.get(h)! < byHost.get(h)!.length) return true;
    }
    return false;
  };
  const runOne = async (ep: EndpointRecord): Promise<void> => {
    const h = hostOf(ep.origin);
    try {
      const res = await probe(ep, { resolveOutputValidator });
      results.set(ep.id, res);
      probedIds.add(ep.id);
      // Best-effort back-off: throttle a host that keeps rejecting us.
      if (res.reason === "http_429" || res.reason === "http_403") {
        backoff.set(h, (backoff.get(h) ?? 0) + 1);
      } else {
        backoff.set(h, 0);
      }
    } catch {
      // A buggy/hostile probe must never reject Promise.all and abort the whole crawl — fail soft to
      // `unknown` so this endpoint is simply left unverified (the end-of-scheduler pass won't overwrite it).
      results.set(ep.id, { verdict: "unknown", reason: "probe_error" });
    } finally {
      inFlight.set(h, (inFlight.get(h) ?? 0) - 1);
    }
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      const ep = nextEndpoint();
      if (ep) {
        await runOne(ep);
        continue;
      }
      if (!remainingWork()) return; // truly done (vs momentarily at-cap)
      await new Promise((r) => setImmediate(r)); // hosts at cap — yield, then retry
    }
  };
  // Never spawn more workers than can ever run at once: the per-host cap bounds runnable probes at
  // hosts.length * PROBE_PER_HOST, so extra workers would only spin idle. Purely an efficiency cap.
  const poolSize = Math.min(PROBE_CONCURRENCY, Math.max(1, hosts.length * PROBE_PER_HOST));
  await Promise.all(Array.from({ length: poolSize }, worker));

  // Any eligible endpoint skipped by host back-off never got a result → stamp unknown.
  for (const ep of toProbe) {
    if (!results.has(ep.id)) results.set(ep.id, { verdict: "unknown", reason: "host_backoff" });
  }

  // (4) Stamp every record from its result + build the verdict map for the breaker.
  const verdictMap = new Map<string, Verdict>();
  for (const ep of merged) {
    const res = results.get(ep.id);
    if (!res) continue;
    ep.payment_verified = res.verdict;
    // Reused-from-cache verdicts keep their original probe time; everything else was determined now.
    ep.payment_verified_at = reusedVerifiedAt.get(ep.id) ?? built;
    if (res.verdict === "verified" && res.challenge) ep.payment.live_challenge = res.challenge;
    verdictMap.set(ep.id, res.verdict);
  }
  // Refresh the cache for freshly-probed endpoints only (reused entries keep their original age).
  for (const id of probedIds) {
    const res = results.get(id)!;
    // Documented invariant: only verified/contradicted are cached — `unknown` is re-probed every run.
    // Clear any stale entry so a now-superseded verdict can't linger.
    if (res.verdict === "unknown") { delete cache[id]; continue; }
    const entry: CachedVerdict = { verdict: res.verdict, reason: res.reason, verified_at: built };
    if (res.challenge) entry.challenge = res.challenge;
    cache[id] = entry;
  }

  // (5) Circuit-breaker over the catalog delta vs the prior index.
  const priorEndpoints = prior?.endpoints ?? []; // guard the property, not the call result (cf. 203/256)
  const priorIds = new Set(priorEndpoints.map((e) => e.id));
  const priorClaimedPaid = priorEndpoints.filter(isClaimedPaid).length;
  const { tripped, newlyDropped } = applyCircuitBreaker(verdictMap, priorIds, priorClaimedPaid);

  // Reason histogram over the claimed-paid surface (stable across a downgrade — reasons don't change).
  const reasons: Record<string, number> = {};
  for (const ep of merged) {
    if (!isClaimedPaid(ep)) continue;
    const res = results.get(ep.id);
    if (res) reasons[res.reason] = (reasons[res.reason] ?? 0) + 1;
  }

  if (tripped) {
    let downgraded = 0;
    for (const ep of merged) {
      if (ep.payment_verified === "contradicted") {
        ep.payment_verified = "unknown";
        delete cache[ep.id]; // never persist a contradicted verdict from a tripped run
        downgraded++;
      }
    }
    console.error(
      `verify: !!! CIRCUIT BREAKER TRIPPED !!! newlyDropped=${newlyDropped} / priorClaimedPaid=${priorClaimedPaid} ` +
        `exceeded threshold — downgraded ${downgraded} contradicted→unknown (not cached). reasons=${JSON.stringify(reasons)}`,
    );
    process.exitCode = 1;
  }

  // Prune the cache to the seen-id set (+ absolute age cap) and persist.
  await saveVerdictCache(outputDir, pruneCache(cache, seenIds, nowMs));

  // (6) Metrics — verdict counts over claimed-paid + reason histogram + newlyDropped delta.
  let verified = 0;
  let contradicted = 0;
  let unknown = 0;
  for (const ep of merged) {
    if (!isClaimedPaid(ep)) continue;
    if (ep.payment_verified === "verified") verified++;
    else if (ep.payment_verified === "contradicted") contradicted++;
    else unknown++;
  }
  console.error(
    `verify: ${verified} verified / ${contradicted} contradicted / ${unknown} unknown ` +
      `(of ${verified + contradicted + unknown} claimed-paid); probed ${probedIds.size}; ` +
      `newlyDropped=${newlyDropped}; reasons=${JSON.stringify(reasons)}`,
  );

  return merged;
}
