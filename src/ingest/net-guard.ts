import { Agent } from "undici";
import { isIP } from "node:net";
import { lookup as dnsLookupCb } from "node:dns";

/** Parse a dotted IPv4 string to its 4 octets, or null if malformed. Rejects octal/hex/oversized. */
function ipv4ToBytes(s: string): number[] | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null; // decimal only, ≤3 digits (no octal/hex/leading-plus)
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

/** Parse an IPv6 string to its 16 bytes, or null if not a parseable IPv6.
 *  Handles `::` compression, hextet groups, and an embedded IPv4 tail (e.g. `::ffff:1.2.3.4`).
 *  Fail-closed: any ambiguity/malformation returns null so callers treat it as non-public. */
function ipv6ToBytes(input: string): number[] | null {
  if (typeof input !== "string" || input.length === 0) return null;
  // Drop a zone id (fe80::1%eth0) — the address portion is what we vet.
  const pct = input.indexOf("%");
  const s = pct === -1 ? input : input.slice(0, pct);

  const halves = s.split("::");
  if (halves.length > 2) return null; // at most one "::"

  // Parse a colon-separated run of hextets, with an optional dotted-IPv4 final group.
  const parseRun = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups = segment.split(":");
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g === "") return null; // stray empty group (not produced by "::")
      if (i === groups.length - 1 && g.indexOf(".") !== -1) {
        const v4 = ipv4ToBytes(g); // embedded IPv4 tail
        if (!v4) return null;
        out.push(v4[0], v4[1], v4[2], v4[3]);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        const val = parseInt(g, 16);
        out.push((val >> 8) & 0xff, val & 0xff);
      }
    }
    return out;
  };

  if (halves.length === 1) {
    const bytes = parseRun(halves[0]); // fully specified, must be exactly 16 bytes
    return bytes && bytes.length === 16 ? bytes : null;
  }

  const head = parseRun(halves[0]);
  const tail = parseRun(halves[1]);
  if (!head || !tail) return null;
  const missing = 16 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for ≥1 zero group
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** CIDR containment test for IPv4. Parses both sides to uint32 and mask-compares. */
function inCidrV4(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const ipB = ipv4ToBytes(ip);
  const netB = ipv4ToBytes(net);
  if (!ipB || !netB || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const toU32 = (b: number[]) => ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((toU32(ipB) & mask) >>> 0) === ((toU32(netB) & mask) >>> 0);
}

/** IPv4 ranges that are never globally-routable unicast (RFC 6890 special-purpose + friends). */
const V4_DENY: readonly string[] = [
  "0.0.0.0/8", // "this host"
  "10.0.0.0/8", // private
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local + cloud metadata (169.254.169.254)
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF protocol assignments
  "192.0.2.0/24", // TEST-NET-1 (documentation)
  "192.88.99.0/24", // 6to4 relay anycast
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2 (documentation)
  "203.0.113.0/24", // TEST-NET-3 (documentation)
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved (incl. 255.255.255.255 broadcast)
];

function isPublicV4(ip: string): boolean {
  for (const cidr of V4_DENY) if (inCidrV4(ip, cidr)) return false;
  return true;
}

/** If the 16 v6 bytes embed an IPv4 address, return its dotted form; else null. */
function embeddedV4(b: number[]): string | null {
  const isZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const dotted = () => `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  // IPv4-mapped ::ffff:0:0/96 — catches BOTH dotted (::ffff:10.0.0.1) and hex (::ffff:a00:1).
  if (isZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return dotted();
  // NAT64 well-known prefix 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && isZero(4, 12)) return dotted();
  // NAT64 local-use prefix 64:ff9b:1::/48
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b[4] === 0x00 && b[5] === 0x01)
    return dotted();
  // Deprecated IPv4-compatible ::/96 (all-zero high 96 bits, non-zero tail)
  if (isZero(0, 12) && !isZero(12, 16)) return dotted();
  return null;
}

/** True only for globally-routable unicast addresses. Rejects loopback / private / link-local /
 *  cloud-metadata / ULA / documentation / benchmarking ranges and their IPv4-embedded IPv6 forms.
 *  Normalize-then-check: parse to bytes, unwrap embedded IPv4, then match against explicit deny
 *  tables. Fail-closed — anything that does not parse as a valid IP is treated as non-public. */
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== "string") return false;
  if (isIP(ip) === 4) return isPublicV4(ip);

  const bytes = ipv6ToBytes(ip);
  if (!bytes) return false; // not IPv4 and not parseable IPv6 → fail-closed
  if (isIP(ip) === 0) return false; // defensive: parsed to bytes but Node rejects the literal

  const embedded = embeddedV4(bytes);
  if (embedded) return isPublicAddress(embedded); // recurse on the dotted IPv4

  const b0 = bytes[0];
  const b1 = bytes[1];
  if (bytes.every((x) => x === 0)) return false; // :: unspecified
  if (bytes.slice(0, 15).every((x) => x === 0) && bytes[15] === 1) return false; // ::1 loopback
  if (b0 === 0xfc || b0 === 0xfd) return false; // fc00::/7 ULA
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return false; // fe80::/10 link-local (fe80–febf)
  if (b0 === 0xff) return false; // ff00::/8 multicast
  return true;
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
    // Per-request Agent (one per hop) — bound its socket lifetime so the idle socket is reaped almost
    // immediately after the caller consumes the body, letting the agent object GC promptly instead of
    // relying on finalization. (No shared agent: the pinned-lookup must stay per-hop for SSRF safety.)
    const agent = new Agent({
      connect: { lookup: (_h, _o, cb) => cb(null, pinned, isIP(pinned) as 4 | 6) },
      keepAliveTimeout: 1,
      keepAliveMaxTimeout: 1,
      pipelining: 0,
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
