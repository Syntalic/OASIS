#!/usr/bin/env node
/**
 * Regenerate src/data/ontology.json from a built OASIS index.
 *
 * The explorer ships a slim, denormalized graph derived from the full OASIS
 * index (dist/index.json), which is ~50 MB and gitignored. This script distills
 * it to the ~150 KB the UI actually needs: domains, capabilities (with facets,
 * entities, endpoint counts, top providers and a few sample endpoints) and the
 * entity producer/consumer adjacency.
 *
 * Usage:
 *   node scripts/build-dataset.mjs [path/to/index.json]
 *   OASIS_INDEX=/abs/path/to/index.json node scripts/build-dataset.mjs
 *
 * Default search order for the index:
 *   $OASIS_INDEX, ../dist/index.json, ../../OASIS/dist/index.json, ./dist/index.json
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const candidates = [
  process.argv[2],
  process.env.OASIS_INDEX,
  resolve(root, "..", "dist", "index.json"),
  resolve(root, "..", "..", "OASIS", "dist", "index.json"),
  resolve(root, "dist", "index.json"),
].filter(Boolean);

// Source the index: a local built dist/index.json when present (local dev), otherwise the PINNED
// release asset recorded in dist-snapshot.lock.json. This is what makes the deployed dashboard
// auto-refresh on a new index release — publish.sh commits the lock, Vercel rebuilds, and this
// fetches the just-pinned index. Override with OASIS_INDEX (local path) or OASIS_INDEX_URL (gz/json URL).
async function loadIndex() {
  const local = candidates.find((p) => existsSync(p));
  if (local) {
    console.log("Reading index (local):", local);
    return JSON.parse(readFileSync(local, "utf8"));
  }
  let url = process.env.OASIS_INDEX_URL;
  if (!url) {
    const lockPath = resolve(root, "..", "dist-snapshot.lock.json");
    if (!existsSync(lockPath)) {
      console.error("No local index found and no dist-snapshot.lock.json at " + lockPath);
      console.error("Build the index (`pnpm run build`) or set OASIS_INDEX / OASIS_INDEX_URL.");
      process.exit(1);
    }
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    const repo = process.env.OASIS_REPO || "Syntalic/OASIS";
    url = `https://github.com/${repo}/releases/download/${lock.release_tag}/${lock.asset || "index.json.gz"}`;
  }
  console.log("No local index; fetching pinned release:", url);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    console.error(`Failed to fetch pinned index (${res.status} ${res.statusText}): ${url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const json = url.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(json);
}

const d = await loadIndex();

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

const capabilities = d.capabilities.map((c) => {
  const sat = c.satisfies ?? [];
  const hostCount = {};
  for (const s of sat) {
    const h = hostOf(s.origin);
    hostCount[h] = (hostCount[h] ?? 0) + 1;
  }
  const topProviders = Object.entries(hostCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([host, n]) => ({ host, n }));

  return {
    id: c.id,
    label: c.label,
    description: c.description ?? "",
    aliases: c.aliases ?? [],
    domain: c.facets?.domain ?? "other",
    action: c.facets?.action ?? null,
    modality: c.facets?.modality ?? [],
    freshness: c.facets?.freshness ?? null,
    consumes: (c.consumes ?? []).map((p) => ({ entity: p.entity, role: p.role ?? null, format: p.format ?? null })),
    produces: (c.produces ?? []).map((p) => ({ entity: p.entity, role: p.role ?? null, format: p.format ?? null })),
    endpointCount: sat.length,
    topProviders,
    sampleEndpoints: sat.slice(0, 6).map((s) => ({
      origin: s.origin,
      method: s.method,
      path: s.path,
      source: s.source ?? null,
      confidence: s.confidence ?? null,
    })),
  };
});

// entities (producer/consumer adjacency)
const entMap = {};
for (const c of capabilities) {
  for (const p of c.produces) (entMap[p.entity] ??= { name: p.entity, producedBy: [], consumedBy: [] }).producedBy.push(c.id);
  for (const p of c.consumes) (entMap[p.entity] ??= { name: p.entity, producedBy: [], consumedBy: [] }).consumedBy.push(c.id);
}
const entities = Object.values(entMap).sort((a, b) => a.name.localeCompare(b.name));

// domains
const domMap = {};
for (const c of capabilities) {
  (domMap[c.domain] ??= { id: c.domain, capabilities: [], endpointCount: 0 });
  domMap[c.domain].capabilities.push(c.id);
  domMap[c.domain].endpointCount += c.endpointCount;
}
const domains = Object.values(domMap).sort((a, b) => b.capabilities.length - a.capabilities.length);

const out = {
  built_at: d.built_at,
  stats: {
    domains: domains.length,
    capabilities: capabilities.length,
    entities: entities.length,
    boundEndpoints: capabilities.reduce((s, c) => s + c.endpointCount, 0),
  },
  domains,
  entities,
  capabilities,
};

const outPath = resolve(root, "src", "data", "ontology.json");
writeFileSync(outPath, JSON.stringify(out));
console.log("Wrote", outPath, (JSON.stringify(out).length / 1024).toFixed(1) + " KB");
console.log("Stats:", JSON.stringify(out.stats));

/* ------------------------------------------------------------------ */
/* Catalog coverage — services ↔ wallets ↔ endpoints (for /coverage)    */
/* Master-detail UI: lists + drill-down, not the ontology React Flow.  */
/* ------------------------------------------------------------------ */

const hostOfOrigin = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
};

const svcMap = new Map();
const walletMap = new Map(); // lowercased payTo
/** @type {Map<string, Array<object>>} */
const endpointsByOrigin = new Map();
let endpointsPaid = 0;
let endpointsWithPayTo = 0;
let endpointsUsageActive = 0;
let endpointsUsageVolume = 0;
let endpointsWithVolumeUsd = 0;

for (const ep of d.endpoints ?? []) {
  const origin = ep.origin ?? "";
  let svc = svcMap.get(origin);
  if (!svc) {
    svc = {
      origin,
      host: hostOfOrigin(origin),
      endpoints: 0,
      paid: 0,
      free: 0,
      withPayTo: 0,
      withoutPayTo: 0,
      payTos: new Set(),
      volume_usd: 0,
      usage_active: false,
      usage_stage: null,
    };
    svcMap.set(origin, svc);
  }
  svc.endpoints += 1;
  if (ep.payment?.paid) {
    endpointsPaid += 1;
    svc.paid += 1;
  } else {
    svc.free += 1;
  }

  const payTos = [];
  for (const ch of ep.payment?.live_challenge ?? []) {
    for (const a of ch.accepts ?? []) {
      const p = (a.payTo ?? "").trim();
      if (p) payTos.push(p);
    }
  }
  for (const dcl of ep.payment?.declared_pay_tos ?? []) {
    const p = (dcl.payTo ?? "").trim();
    if (p) payTos.push(p);
  }
  const payToKeys = [...new Set(payTos.map((p) => p.toLowerCase()))];

  if (payTos.length) {
    endpointsWithPayTo += 1;
    svc.withPayTo += 1;
  } else {
    svc.withoutPayTo += 1;
  }

  if (ep.usage?.active === true) {
    endpointsUsageActive += 1;
    svc.usage_active = true;
  }
  if (ep.usage?.stage === "volume") {
    endpointsUsageVolume += 1;
    svc.usage_stage = "volume";
  }
  if (typeof ep.usage?.volume_usd === "number" && ep.usage.volume_usd > 0) {
    endpointsWithVolumeUsd += 1;
    if (ep.usage.volume_usd > svc.volume_usd) svc.volume_usd = ep.usage.volume_usd;
  }

  for (const p of payTos) {
    const key = p.toLowerCase();
    svc.payTos.add(key);
    let w = walletMap.get(key);
    if (!w) {
      w = {
        payTo: p,
        kind: /^0x[a-fA-F0-9]{40}$/.test(p) ? "evm" : "sol",
        endpoints: 0,
        origins: new Set(),
        volume_usd: 0,
        transactions: 0,
        unique_buyers: 0,
        active: false,
        stage: null,
        source: null,
      };
      walletMap.set(key, w);
    }
    w.endpoints += 1;
    w.origins.add(origin);
    if (ep.usage?.active === true) w.active = true;
    if (ep.usage?.stage) w.stage = ep.usage.stage;
    if (ep.usage?.source) w.source = ep.usage.source;
    if (typeof ep.usage?.volume_usd === "number" && ep.usage.volume_usd > (w.volume_usd || 0)) {
      w.volume_usd = ep.usage.volume_usd;
    }
    if (typeof ep.usage?.transactions === "number" && ep.usage.transactions > (w.transactions || 0)) {
      w.transactions = ep.usage.transactions;
    }
    if (typeof ep.usage?.unique_buyers === "number" && ep.usage.unique_buyers > (w.unique_buyers || 0)) {
      w.unique_buyers = ep.usage.unique_buyers;
    }
  }

  // Compact endpoint row for drill-down (only attach when origin has any payTo later filter)
  const row = {
    method: ep.method,
    path: ep.path,
    paid: !!ep.payment?.paid,
    price_usd: typeof ep.payment?.price_usd === "number" ? ep.payment.price_usd : undefined,
    summary: (ep.summary || "").slice(0, 120) || undefined,
    payTos: payToKeys.length ? payToKeys : undefined,
    capabilities: (ep.capabilities ?? []).slice(0, 4),
    verified: ep.payment_verified || undefined,
  };
  if (!endpointsByOrigin.has(origin)) endpointsByOrigin.set(origin, []);
  endpointsByOrigin.get(origin).push(row);
}

const services = [...svcMap.values()].map((s) => ({
  origin: s.origin,
  host: s.host,
  endpoints: s.endpoints,
  paid: s.paid,
  free: s.free,
  withPayTo: s.withPayTo,
  withoutPayTo: s.withoutPayTo,
  walletCount: s.payTos.size,
  wallets: [...s.payTos],
  volume_usd: s.volume_usd || undefined,
  usage_active: s.usage_active,
  usage_stage: s.usage_stage,
}));

const wallets = [...walletMap.values()].map((w) => ({
  payTo: w.payTo,
  kind: w.kind,
  endpoints: w.endpoints,
  serviceCount: w.origins.size,
  services: [...w.origins],
  volume_usd: w.volume_usd || undefined,
  transactions: w.transactions || undefined,
  unique_buyers: w.unique_buyers || undefined,
  active: w.active,
  stage: w.stage,
  source: w.source,
}));

const servicesWithWallet = services.filter((s) => s.walletCount > 0);
const servicesWithoutWallet = services.filter((s) => s.walletCount === 0);
const multiServiceWallets = wallets.filter((w) => w.serviceCount > 1);
const multiWalletServices = services.filter((s) => s.walletCount > 1);

// Endpoint lists only for services that have a live payTo (keeps payload ~1MB, not full 18k orphan noise)
const endpoints_by_origin = {};
for (const s of servicesWithWallet) {
  endpoints_by_origin[s.origin] = endpointsByOrigin.get(s.origin) ?? [];
}

const funnel = [
  { id: "endpoints", label: "Endpoints", count: (d.endpoints ?? []).length, hint: "All indexed HTTP operations" },
  { id: "paid", label: "Paid (declared)", count: endpointsPaid, hint: "payment.paid from OpenAPI / discovery" },
  { id: "with_payto", label: "With live payTo", count: endpointsWithPayTo, hint: "Merchant wallet from live 402 challenge" },
  { id: "wallets", label: "Unique merchant wallets", count: wallets.length, hint: "Service-level payTo addresses (deduped)" },
  { id: "usage_volume", label: "Stamped usage (volume)", count: endpointsUsageVolume, hint: "Endpoints with stage=volume on-chain enrich" },
];

const catalog = {
  built_at: d.built_at,
  stats: {
    endpoints: (d.endpoints ?? []).length,
    origins: services.length,
    paid_endpoints: endpointsPaid,
    free_or_unpaid_endpoints: (d.endpoints ?? []).length - endpointsPaid,
    endpoints_with_payto: endpointsWithPayTo,
    endpoints_without_payto: (d.endpoints ?? []).length - endpointsWithPayTo,
    services_with_wallet: servicesWithWallet.length,
    services_without_wallet: servicesWithoutWallet.length,
    unique_wallets: wallets.length,
    wallets_active: wallets.filter((w) => w.active).length,
    multi_service_wallets: multiServiceWallets.length,
    multi_wallet_services: multiWalletServices.length,
    endpoints_usage_active: endpointsUsageActive,
    endpoints_usage_volume: endpointsUsageVolume,
    endpoints_with_volume_usd: endpointsWithVolumeUsd,
  },
  funnel,
  // Full browsable indexes for master-detail UI
  services: services
    .map(({ origin, host, endpoints, paid, free, withPayTo, withoutPayTo, walletCount, wallets: ws, volume_usd, usage_active, usage_stage }) => ({
      origin,
      host,
      endpoints,
      paid,
      free,
      withPayTo,
      withoutPayTo,
      walletCount,
      wallets: ws,
      volume_usd,
      usage_active,
      usage_stage,
    }))
    .sort((a, b) => b.withPayTo - a.withPayTo || b.endpoints - a.endpoints),
  wallets: wallets
    .map((w) => ({
      payTo: w.payTo,
      kind: w.kind,
      endpoints: w.endpoints,
      serviceCount: w.serviceCount,
      services: w.services,
      volume_usd: w.volume_usd,
      transactions: w.transactions,
      unique_buyers: w.unique_buyers,
      active: w.active,
      stage: w.stage,
      source: w.source,
    }))
    .sort((a, b) => (b.volume_usd ?? 0) - (a.volume_usd ?? 0) || b.endpoints - a.endpoints),
  endpoints_by_origin,
};

const catalogPath = resolve(root, "src", "data", "catalog.json");
writeFileSync(catalogPath, JSON.stringify(catalog));
console.log("Wrote", catalogPath, (JSON.stringify(catalog).length / 1024).toFixed(1) + " KB");
console.log("Catalog:", JSON.stringify(catalog.stats));
