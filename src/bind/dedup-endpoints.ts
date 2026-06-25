import type { EndpointRecord } from "../core/types.js";

// Mirror hosts: a provider's real domain plus a PaaS deploy clone serving the IDENTICAL catalog
// (e.g. `x402.agentutility.ai` + `x402-deployer.…workers.dev`). The endpoint id is
// sha256(origin|method|path), so mirrors survive ingest's origin-dedup as distinct records and
// double every binding. We collapse records that share (method, path, summary) across origins,
// preferring the stable (non-PaaS) host.
const PAAS_HOST = /\.workers\.dev$|\.up\.railway\.app$|\.vercel\.app$|\.run\.app$|\.fly\.dev$|\.onrender\.com$/i;

const norm = (s: string | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const hostOf = (origin: string | undefined): string => (origin ?? "").replace(/^https?:\/\//, "");

/** Collapse mirror endpoints to one canonical record per (method, path, summary). Records with no
 *  summary are never merged (too risky). Returns the kept set + how many mirrors were dropped. */
export function dedupeMirrors(endpoints: EndpointRecord[]): { kept: EndpointRecord[]; dropped: number } {
  const groups = new Map<string, EndpointRecord[]>();
  for (const e of endpoints) {
    const summary = norm(e.summary);
    // No summary ⇒ keep unique (don't risk merging unrelated endpoints that only share a path).
    const key = summary
      ? `${e.method}|${(e.path ?? "").toLowerCase()}|${summary}`
      : `__uniq__|${e.origin}|${e.method}|${e.path}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  // Prefer a stable host (PaaS clone loses), then the shorter origin (deterministic tiebreak).
  const rank = (e: EndpointRecord): [number, number] => [PAAS_HOST.test(hostOf(e.origin)) ? 1 : 0, hostOf(e.origin).length];
  const kept: EndpointRecord[] = [];
  let dropped = 0;
  for (const grp of groups.values()) {
    if (grp.length === 1) { kept.push(grp[0]); continue; }
    grp.sort((a, b) => { const [ap, al] = rank(a); const [bp, bl] = rank(b); return ap - bp || al - bl; });
    kept.push(grp[0]);
    dropped += grp.length - 1;
  }
  return { kept, dropped };
}
