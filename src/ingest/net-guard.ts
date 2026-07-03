import { Agent } from "undici";
import { isIP } from "node:net";
import { lookup as dnsLookupCb } from "node:dns";

/** True only for globally-routable unicast addresses. Rejects loopback / private / link-local /
 *  cloud-metadata / ULA and their IPv4-mapped-IPv6 forms. */
export function isPublicAddress(ip: string): boolean {
  let a = ip;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a); // IPv4-mapped IPv6
  if (m) a = m[1];
  const v = isIP(a);
  if (v === 4) {
    const p = a.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [x, y] = p;
    if (x === 10 || x === 127 || x === 0) return false;              // private / loopback / this-host
    if (x === 172 && y >= 16 && y <= 31) return false;               // 172.16/12
    if (x === 192 && y === 168) return false;                        // 192.168/16
    if (x === 169 && y === 254) return false;                        // link-local + metadata
    if (x === 100 && y >= 64 && y <= 127) return false;              // CGNAT 100.64/10
    if (x >= 224) return false;                                      // multicast / reserved
    return true;
  }
  if (v === 6) {
    const lc = a.toLowerCase();
    if (lc === "::1" || lc === "::") return false;
    if (lc.startsWith("fe80") || lc.startsWith("fc") || lc.startsWith("fd")) return false; // link-local / ULA
    if (lc.startsWith("ff")) return false;                           // multicast
    return true;
  }
  return false; // not an IP
}

type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = (host) =>
  new Promise((res, rej) => dnsLookupCb(host, { all: true }, (e, addrs) =>
    e ? rej(e) : res(addrs.map((x) => x.address))));

/** Reject the host unless EVERY resolved address is public (reject-if-any, anti-rebinding by pinning). */
export async function assertPublicHost(hostname: string, resolver: Resolver = defaultResolver): Promise<string[]> {
  const ips = isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!ips.length) throw new Error(`net-guard: ${hostname} did not resolve`);
  for (const ip of ips) if (!isPublicAddress(ip)) throw new Error(`net-guard: ${hostname} → ${ip} is not public`);
  return ips;
}

/** fetch() that (1) allows only http/https, (2) resolves+vets the host and pins the vetted IP for
 *  the connection (TLS/SNI/Host preserved), (3) manual redirects, ≤2 hops, re-vetting each hop. */
export async function safeFetch(url: string, opts: RequestInit = {}, resolver: Resolver = defaultResolver): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 2; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`net-guard: scheme ${u.protocol}`);
    const vetted = await assertPublicHost(u.hostname, resolver);
    const pinned = vetted[0];
    const agent = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, pinned, isIP(pinned) as 4 | 6) },
    });
    const res = await fetch(current, { ...opts, redirect: "manual", dispatcher: agent } as RequestInit);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue; // re-vet next hop
    }
    return res;
  }
  throw new Error("net-guard: too many redirects");
}
