/**
 * Free on-chain usage enrichment for merchant payTo wallets.
 *
 * Two stages (env OASIS_USAGE_STAGE=activity|volume, default activity):
 *
 *   1. **activity** (cheap) — one tiny free probe per unique payTo:
 *        • Base: Blockscout tokentx page=1 offset=1
 *        • Solana: getSignaturesForAddress limit=1
 *      Stamps usage.active true/false. Optional drop of endpoints whose wallets
 *      are all inactive (OASIS_USAGE_DROP_INACTIVE=1, default on for activity).
 *
 *   2. **volume** (later) — deeper pages / Dune for volume_usd + buyers ranking.
 *
 * **Service vs endpoint:** payTo is almost always shared across an origin's
 * endpoints. We collect unique wallets, probe once, then stamp the same snapshot
 * onto every endpoint that advertises that payTo — de facto **service-level**
 * demand, not per-path revenue (unless each op has its own wallet, rare).
 *
 * Failures never break the build.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { EndpointRecord, IndexBundle, UsageSnapshot } from "../core/types.js";

/** Base mainnet USDC (Circle). */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_BLOCKSCOUT = "https://base.blockscout.com/api";
const SOLANA_RPC = process.env.OASIS_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

const ETH_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type UsageStage = "activity" | "volume";

export interface PayToRef {
  payTo: string;
  network?: string;
  asset?: string;
  /** Endpoint ids that list this payTo (many → service-level wallet). */
  endpointIds: string[];
  /** Distinct origins using this wallet. */
  origins: string[];
}

/**
 * Collect unique merchant wallets from live 402 challenges **and** OpenAPI-declared
 * payTos (`payment.declared_pay_tos` — recipient / pay_to / faremeter, etc.).
 */
export function collectPayTos(endpoints: EndpointRecord[]): PayToRef[] {
  const map = new Map<string, PayToRef>();

  const touch = (
    payToRaw: string,
    ep: EndpointRecord,
    meta?: { network?: string; asset?: string },
  ) => {
    const payTo = payToRaw.trim();
    if (!payTo) return;
    const key = payTo.toLowerCase();
    let ref = map.get(key);
    if (!ref) {
      ref = {
        payTo,
        network: meta?.network,
        asset: meta?.asset,
        endpointIds: [],
        origins: [],
      };
      map.set(key, ref);
    }
    if (!ref.endpointIds.includes(ep.id)) ref.endpointIds.push(ep.id);
    if (!ref.origins.includes(ep.origin)) ref.origins.push(ep.origin);
    if (!ref.network && meta?.network) ref.network = meta.network;
    if (!ref.asset && meta?.asset) ref.asset = meta.asset;
  };

  for (const ep of endpoints) {
    for (const ch of ep.payment?.live_challenge ?? []) {
      for (const a of ch.accepts ?? []) {
        if (a.payTo) touch(a.payTo, ep, { network: a.network, asset: a.asset });
      }
    }
    for (const d of ep.payment?.declared_pay_tos ?? []) {
      if (d.payTo) touch(d.payTo, ep, { network: d.network, asset: d.asset });
    }
  }
  return [...map.values()];
}

function isEvm(addr: string): boolean {
  return ETH_RE.test(addr);
}
function isSol(addr: string): boolean {
  return !addr.startsWith("0x") && SOL_RE.test(addr);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface BlockscoutTx {
  from?: string;
  to?: string;
  value?: string;
  tokenDecimal?: string;
  timeStamp?: string;
}

/** Stage-1: does this EVM wallet have *any* inbound Base USDC transfer? */
export async function probeBaseUsdcActivity(
  payTo: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ active: boolean; source: "base-blockscout" }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url =
    `${BASE_BLOCKSCOUT}?module=account&action=tokentx` +
    `&address=${encodeURIComponent(payTo)}` +
    `&contractaddress=${BASE_USDC}` +
    `&page=1&offset=1&sort=desc`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return { active: false, source: "base-blockscout" };
  const body = (await res.json()) as { result?: BlockscoutTx[] | string };
  const rows = Array.isArray(body.result) ? body.result : [];
  // Any inbound to merchant (or any USDC touch — Blockscout filters by address participation)
  const active = rows.some(
    (tx) => (tx.to ?? "").toLowerCase() === payTo.toLowerCase() || rows.length > 0,
  );
  return { active: active && rows.length > 0, source: "base-blockscout" };
}

/** Stage-1: any Solana signature at all? */
export async function probeSolanaActivity(
  payTo: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ active: boolean; source: "solana-rpc" }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [payTo, { limit: 1 }],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return { active: false, source: "solana-rpc" };
  const body = (await res.json()) as { result?: unknown[] };
  const n = Array.isArray(body.result) ? body.result.length : 0;
  return { active: n > 0, source: "solana-rpc" };
}

/** Stage-2 volume (deeper) — Base USDC multi-page. */
export async function fetchBaseUsdcUsage(
  payTo: string,
  opts: { fetchImpl?: typeof fetch; pages?: number; pageSize?: number } = {},
): Promise<Pick<UsageSnapshot, "volume_usd" | "transactions" | "unique_buyers">> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pages = opts.pages ?? 3;
  const pageSize = opts.pageSize ?? 100;
  let volumeAtomic = 0n;
  let decimals = 6;
  const buyers = new Set<string>();
  let txCount = 0;

  for (let page = 1; page <= pages; page++) {
    const url =
      `${BASE_BLOCKSCOUT}?module=account&action=tokentx` +
      `&address=${encodeURIComponent(payTo)}` +
      `&contractaddress=${BASE_USDC}` +
      `&page=${page}&offset=${pageSize}&sort=desc`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) break;
    const body = (await res.json()) as { result?: BlockscoutTx[] | string };
    const rows = Array.isArray(body.result) ? body.result : [];
    if (!rows.length) break;

    for (const tx of rows) {
      if ((tx.to ?? "").toLowerCase() !== payTo.toLowerCase()) continue;
      txCount += 1;
      if (tx.from) buyers.add(tx.from.toLowerCase());
      if (tx.tokenDecimal != null) decimals = Number(tx.tokenDecimal) || decimals;
      try {
        volumeAtomic += BigInt(tx.value ?? "0");
      } catch {
        /* skip */
      }
    }
    if (rows.length < pageSize) break;
    await sleep(250);
  }

  const volume_usd = Number(volumeAtomic) / 10 ** decimals;
  return {
    volume_usd: Number.isFinite(volume_usd) ? volume_usd : undefined,
    transactions: txCount || undefined,
    unique_buyers: buyers.size || undefined,
  };
}

export async function fetchSolanaTxCount(
  payTo: string,
  opts: { fetchImpl?: typeof fetch; limit?: number } = {},
): Promise<Pick<UsageSnapshot, "transactions">> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const limit = opts.limit ?? 100;
  const res = await fetchImpl(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [payTo, { limit }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return {};
  const body = (await res.json()) as { result?: unknown[] };
  const n = Array.isArray(body.result) ? body.result.length : 0;
  return { transactions: n || undefined };
}

export async function enrichPayToActivity(
  ref: PayToRef,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<UsageSnapshot | null> {
  const observed_at = new Date().toISOString();
  try {
    if (isEvm(ref.payTo)) {
      const p = await probeBaseUsdcActivity(ref.payTo, opts);
      return {
        active: p.active,
        stage: "activity",
        transactions: p.active ? 1 : 0,
        observed_at,
        source: p.source,
        pay_tos: [ref.payTo],
      };
    }
    if (isSol(ref.payTo)) {
      const p = await probeSolanaActivity(ref.payTo, opts);
      return {
        active: p.active,
        stage: "activity",
        transactions: p.active ? 1 : 0,
        observed_at,
        source: p.source,
        pay_tos: [ref.payTo],
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function enrichPayToVolume(
  ref: PayToRef,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<UsageSnapshot | null> {
  const observed_at = new Date().toISOString();
  try {
    if (isEvm(ref.payTo)) {
      const u = await fetchBaseUsdcUsage(ref.payTo, { fetchImpl: opts.fetchImpl });
      if (!u.transactions && !u.volume_usd) {
        return {
          active: false,
          stage: "volume",
          transactions: 0,
          observed_at,
          source: "base-blockscout",
          pay_tos: [ref.payTo],
        };
      }
      return {
        active: true,
        stage: "volume",
        ...u,
        observed_at,
        source: "base-blockscout",
        pay_tos: [ref.payTo],
      };
    }
    if (isSol(ref.payTo)) {
      const u = await fetchSolanaTxCount(ref.payTo, { fetchImpl: opts.fetchImpl });
      return {
        active: (u.transactions ?? 0) > 0,
        stage: "volume",
        ...u,
        observed_at,
        source: "solana-rpc",
        pay_tos: [ref.payTo],
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function mergeUsage(parts: UsageSnapshot[]): UsageSnapshot | undefined {
  if (!parts.length) return undefined;
  let volume = 0;
  let txs = 0;
  let buyers = 0;
  let anyActive = false;
  let anyInactive = false;
  const pay_tos: string[] = [];
  const sources = new Set<string>();
  let stage: "activity" | "volume" = "activity";
  for (const p of parts) {
    if (p.active === true) anyActive = true;
    if (p.active === false) anyInactive = true;
    if (p.stage === "volume") stage = "volume";
    if (typeof p.volume_usd === "number") volume += p.volume_usd;
    if (typeof p.transactions === "number") txs += p.transactions;
    if (typeof p.unique_buyers === "number") buyers += p.unique_buyers;
    for (const w of p.pay_tos ?? []) if (!pay_tos.includes(w)) pay_tos.push(w);
    sources.add(p.source);
  }
  // Endpoint active if ANY of its wallets has activity.
  const active = anyActive ? true : anyInactive ? false : undefined;
  return {
    active,
    stage,
    volume_usd: volume || undefined,
    transactions: txs || undefined,
    unique_buyers: buyers || undefined,
    observed_at: parts[0]!.observed_at,
    source: sources.size > 1 ? "mixed" : (parts[0]!.source as UsageSnapshot["source"]),
    pay_tos,
  };
}

export interface EnrichUsageResult {
  stage: UsageStage;
  wallets: number;
  wallets_active: number;
  wallets_inactive: number;
  wallets_unknown: number;
  endpoints_stamped: number;
  endpoints_dropped_inactive: number;
  /** Origins where every probed wallet was inactive. */
  origins_all_inactive: number;
  kept: EndpointRecord[];
}

export async function enrichUsageOnEndpoints(
  endpoints: EndpointRecord[],
  opts: {
    stage?: UsageStage;
    concurrency?: number;
    fetchImpl?: typeof fetch;
    maxWallets?: number;
    /** Drop endpoints that have payTo(s) and usage.active === false. Default true for activity. */
    dropInactive?: boolean;
  } = {},
): Promise<EnrichUsageResult> {
  const stage: UsageStage =
    opts.stage ??
    ((process.env.OASIS_USAGE_STAGE as UsageStage | undefined) || "activity");
  const dropInactive =
    opts.dropInactive ??
    (process.env.OASIS_USAGE_DROP_INACTIVE != null
      ? process.env.OASIS_USAGE_DROP_INACTIVE !== "0"
      : stage === "activity");

  const refs = collectPayTos(endpoints);
  const maxWallets = opts.maxWallets ?? Number(process.env.OASIS_USAGE_MAX_WALLETS ?? "500");
  const slice = refs.slice(0, maxWallets);
  const concurrency = opts.concurrency ?? 4;

  const byPayTo = new Map<string, UsageSnapshot>();
  let cursor = 0;
  let wallets_active = 0;
  let wallets_inactive = 0;
  let wallets_unknown = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= slice.length) return;
      const ref = slice[i]!;
      const snap =
        stage === "activity"
          ? await enrichPayToActivity(ref, { fetchImpl: opts.fetchImpl })
          : await enrichPayToVolume(ref, { fetchImpl: opts.fetchImpl });
      if (snap) {
        byPayTo.set(ref.payTo.toLowerCase(), snap);
        if (snap.active === true) wallets_active += 1;
        else if (snap.active === false) wallets_inactive += 1;
        else wallets_unknown += 1;
      } else {
        wallets_unknown += 1;
      }
      await sleep(stage === "activity" ? 120 : 250);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, slice.length)) }, () => worker()));

  // Stamp every endpoint that lists any of the probed payTos (live or OpenAPI-declared).
  let stamped = 0;
  for (const ep of endpoints) {
    const parts: UsageSnapshot[] = [];
    const keys = new Set<string>();
    for (const ch of ep.payment?.live_challenge ?? []) {
      for (const a of ch.accepts ?? []) {
        const p = (a.payTo ?? "").trim().toLowerCase();
        if (p) keys.add(p);
      }
    }
    for (const d of ep.payment?.declared_pay_tos ?? []) {
      const p = (d.payTo ?? "").trim().toLowerCase();
      if (p) keys.add(p);
    }
    for (const p of keys) {
      const snap = byPayTo.get(p);
      if (snap) parts.push(snap);
    }
    const merged = mergeUsage(parts);
    if (merged) {
      ep.usage = merged;
      stamped += 1;
    }
  }

  // Origins whose wallets we probed and all are inactive
  const originWalletState = new Map<string, { active: number; inactive: number }>();
  for (const ref of slice) {
    const snap = byPayTo.get(ref.payTo.toLowerCase());
    for (const origin of ref.origins) {
      const s = originWalletState.get(origin) ?? { active: 0, inactive: 0 };
      if (snap?.active === true) s.active += 1;
      else if (snap?.active === false) s.inactive += 1;
      originWalletState.set(origin, s);
    }
  }
  let origins_all_inactive = 0;
  for (const s of originWalletState.values()) {
    if (s.inactive > 0 && s.active === 0) origins_all_inactive += 1;
  }

  let dropped = 0;
  let kept = endpoints;
  if (dropInactive) {
    kept = [];
    for (const ep of endpoints) {
      // Only drop if we *know* they have a payTo and it is inactive.
      // Endpoints with no payTo (never verified / free) stay.
      if (ep.usage?.active === false) {
        dropped += 1;
        continue;
      }
      kept.push(ep);
    }
  }

  return {
    stage,
    wallets: slice.length,
    wallets_active,
    wallets_inactive,
    wallets_unknown,
    endpoints_stamped: stamped,
    endpoints_dropped_inactive: dropped,
    origins_all_inactive,
    kept,
  };
}

/** CLI / enrich hook: read dist, enrich usage, rewrite (and optionally drop inactive). */
export async function enrichUsageDist(distDir: string): Promise<EnrichUsageResult> {
  const indexPath = path.join(distDir, "index.json");
  const raw = await readFile(indexPath, "utf8");
  const bundle = JSON.parse(raw) as IndexBundle;
  const result = await enrichUsageOnEndpoints(bundle.endpoints);
  bundle.endpoints = result.kept;
  if (bundle.stats) {
    bundle.stats.endpoints = result.kept.length;
    bundle.stats.origins = new Set(result.kept.map((e) => e.origin)).size;
  }
  await mkdir(distDir, { recursive: true });
  await writeFile(indexPath, JSON.stringify(bundle, null, 2));
  await writeFile(
    path.join(distDir, "endpoints.json"),
    JSON.stringify(
      {
        index_version: bundle.index_version,
        spec_version: bundle.spec_version,
        built_at: bundle.built_at,
        stats: bundle.stats,
        endpoints: bundle.endpoints,
      },
      null,
      2,
    ),
  );
  console.error(
    `  usage [${result.stage}]: wallets ${result.wallets_active} active / ${result.wallets_inactive} inactive / ${result.wallets_unknown} unknown of ${result.wallets}; ` +
      `stamped ${result.endpoints_stamped}; dropped inactive ${result.endpoints_dropped_inactive}; ` +
      `origins all-inactive ${result.origins_all_inactive}`,
  );
  return result;
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("enrich-usage.js") || process.argv[1].endsWith("enrich-usage.ts"));

if (isMain) {
  const distDir = path.resolve(process.argv[2] ?? "dist");
  enrichUsageDist(distDir).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
