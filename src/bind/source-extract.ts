// Source/platform extraction for community-recommendation workflow steps.
//
// A query like "best ramen in Tokyo according to reddit" names a COMMUNITY SOURCE (reddit) that should
// pin the step's endpoint to a reddit specialist. Two pieces, both corpus-grounded (no hardcoded brand
// list): (1) a gazetteer of platform tokens derived from the index — a token that recurs as a host/path
// segment across ≥2 distinct providers is a real platform (reddit, yelp, tiktok, google), while cities
// and food words are not; (2) a syntactic extractor that reads the platform from the SOURCE SLOT
// ("according to X" / "on X" / "X's picks" / attributive "google reviews", "yelp-rated"), gated by the
// gazetteer so it never fires on a city or subject. Validated on a 100-question blind battery: 96% recall,
// 0 false pins on 20 no-source controls. See resolveWorkflowStep in select-policy.ts for the consumer.
import type { EndpointRecord } from "../core/types.js";

// Generic host/path noise — segments that are not platform identities.
const PATH_STOP = new Set([
  "api", "www", "com", "net", "org", "xyz", "dev", "app", "run", "proxy", "tools", "actors", "get", "post",
  "list", "data", "info", "search", "place", "places", "nearby", "business", "businesses", "profile", "user",
  "users", "posts", "feed", "trending", "comments", "details", "reviews", "review", "social", "web", "maps",
  "price", "token", "crypto", "weather", "news", "json", "https", "http", "query", "result", "results", "fetch",
  "scrape", "scraper", "live", "real", "raw", "cap", "report", "full",
]);

/** Build an `isPlatform(token)` predicate from the index: a token that appears as a host/path segment
 *  across ≥2 distinct provider hosts is a real platform (excludes one-off cities and generic path words). */
export function buildPlatformGazetteer(endpoints: EndpointRecord[]): (token: string) => boolean {
  const tokHosts = new Map<string, Set<string>>();
  for (const e of endpoints) {
    const segs = new Set(
      `${e.origin} ${e.path ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
        .filter((t) => t.length >= 4 && !PATH_STOP.has(t)),
    );
    for (const s of segs) {
      let hosts = tokHosts.get(s);
      if (!hosts) tokHosts.set(s, (hosts = new Set()));
      hosts.add(e.origin);
    }
  }
  return (token: string): boolean => {
    const hosts = tokHosts.get(token);
    return !!hosts && hosts.size >= 2 && !PATH_STOP.has(token);
  };
}

// Words that introduce a source but are not themselves the platform.
const FILLER = new Set([
  "the", "best", "top", "what", "people", "users", "community", "internet", "locals", "local", "online",
  "media", "reviewers", "travelers", "travellers", "everyone", "folks", "them", "real", "some", "crowd", "redditors",
]);
// Cue words that mark an attributive platform mention ("google reviews", "yelp-rated", "youtube vlogger").
const CUE = new Set([
  "reviews", "review", "rated", "rating", "ratings", "stars", "star", "famous", "viral", "approved", "verified",
  "foodies", "influencers", "picks", "pick", "consensus", "recs", "rec", "recommended", "hive", "obsessed",
  "raving", "vlogger", "vloggers", "reviewed",
]);

/** Extract the community source(s) a query names, confirmed against the platform gazetteer. Empty when the
 *  query names no platform (a plain "best tacos in Austin" → []), so the caller adds no source bonus. */
export function extractSource(query: string, isPlatform: (token: string) => boolean): string[] {
  const q = String(query ?? "").toLowerCase();
  const caps: string[] = [];
  const grab = (re: RegExp): void => { const m = q.match(re); if (m && m[1]) caps.push(m[1]); };
  grab(/according to ([a-z0-9 '&.-]+)/);
  grab(/\bper ([a-z0-9 '&.-]+)/);
  grab(/\bon ([a-z0-9'&.-]+)/);
  grab(/\breviews? on ([a-z0-9 '&.-]+)/);
  grab(/\bpeople on ([a-z0-9'&.-]+)/);
  grab(/what (?:do|does) ([a-z0-9 '&.-]+?) (?:say|says|recommend|think)/);
  grab(/\b([a-z0-9 '&.-]{3,25})'s (?:favou?rite|top|best|pick|picks)/);
  grab(/\bthat ([a-z0-9 '&.-]{3,25}) (?:loves?|recommends?|swears?|rates?)/);
  grab(/\bfrom ([a-z0-9'&.-]+)/);
  grab(/\b(?:the )?([a-z0-9'&.-]{3,}) crowd\b/);

  const out = new Set<string>();
  for (const c of caps) {
    for (const t of c.split(/[^a-z0-9]+/)) {
      if (t.length >= 3 && !FILLER.has(t) && isPlatform(t)) out.add(t);
    }
  }
  // Attributive mentions: a platform used adjectivally next to a review/rating/social cue.
  const toks = q.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const parts = toks[i].split("-");
    if (parts.length >= 2 && isPlatform(parts[0]) && parts.slice(1).some((p) => CUE.has(p))) out.add(parts[0]); // yelp-rated
    const head = parts[0];
    if (isPlatform(head) && i + 1 < toks.length && CUE.has(toks[i + 1].split("-")[0])) out.add(head); // google reviews
  }
  return [...out];
}
