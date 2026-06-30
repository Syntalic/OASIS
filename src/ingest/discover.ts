// Production ingestion: federate discovery registries → dedup origins → enrich each
// origin's /openapi.json → gate → emit a clean IndexBundle (dist/index.json). The semantic
// binder (enrich-facets) runs next in the build to bind endpoints to intents + materialize.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { endpointId } from "../core/id.js";
import { baseUnitsToUsd, parseAmountHint } from "../core/money.js";
import { parseOpenApi } from "./openapi-parser.js";
import { canonicalOrigin } from "./origin-aliases.js";
import { gradeEndpoint } from "../bind/quality-gate.js";
import type { EndpointRecord, HttpMethod, IndexBundle } from "../core/types.js";
import { bazaarToEndpoint, fetchBazaar } from "./bazaar.js";
import { fetchPayShProviders, payShOrigin } from "./paysh.js";

const SPEC_VERSION = "0.2.0";
const INDEX_VERSION = "0.2.0";
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

/** Strip ranking/debug substrate fields a snapshot may carry → clean EndpointRecord. */
function cleanRecord(r: Record<string, unknown>): EndpointRecord {
  const { _source, _completeness, _flags, _wellknown, ...rest } = r;
  return rest as unknown as EndpointRecord;
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
    return gateAndWrite(recs.map(cleanRecord), opts.outputDir, built);
  }

  const conc = opts.enrichConcurrency ?? 16;
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
  for (const r of bz) addInline(bazaarToEndpoint(r, built), "bazaar");

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

  // --- Enrichment: hop /openapi.json per origin ---
  const enrichedByOrigin = new Map<string, EndpointRecord[]>();
  let i = 0, ok = 0;
  const enrichOne = async (origin: string): Promise<void> => {
    try {
      const res = await fetch(`${origin}/openapi.json`, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
      if (!res.ok) return;
      const buf = await res.text();
      if (buf.length > 2_000_000) return;
      const recs = parseOpenApi(JSON.parse(buf), { origin, builtAt: built });
      if (recs.length) { enrichedByOrigin.set(origin, recs); ok++; }
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
  console.error(`  enriched ${ok} origins`);

  // --- Merge: openapi enrichment overrides registry inline per origin; tag discovery source ---
  const merged: EndpointRecord[] = [];
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
    const ttlMs = staleDays * 86_400_000;
    const nowMs = Date.parse(built);
    const have = new Set(merged.map((e) => e.origin));
    let carried = 0, evicted = 0;
    for (const e of prior.endpoints ?? []) {
      if (have.has(e.origin)) continue; // origin already covered by a fresh probe / inline record
      const seen = Date.parse(e.built_at ?? "");
      if (Number.isFinite(seen) && Number.isFinite(nowMs) && nowMs - seen > ttlMs) { evicted++; continue; }
      merged.push(e);
      carried++;
    }
    console.error(`  carry-forward: +${carried} prior endpoints re-added (origins that didn't re-probe this run); evicted ${evicted} stale > ${staleDays}d`);
  }

  // --- Gate → PASS corpus → bundle ---
  return gateAndWrite(merged, opts.outputDir, built);
}
