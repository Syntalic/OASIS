/**
 * verdict-cache.ts — Asymmetric-TTL verdict cache for live payment verification results.
 *
 * TTL by verdict:
 *   verified     → 7 days  (slow-decaying — paid endpoints stay paid)
 *   contradicted → 2 days  (fast-decaying — re-confirm lies quickly)
 *   unknown      → never fresh (always re-probe if needed)
 *
 * Prune policy: remove entries not in the current crawl's seen-id set OR older than maxAge (2×7d).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Verdict } from './payment-verify.js';
import type { LiveChallenge } from '../core/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CachedVerdict {
  verdict: Verdict;
  reason: string;
  verified_at: string; // ISO-8601
  challenge?: LiveChallenge[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const DEFAULT_VERIFIED_DAYS = 7;
const DEFAULT_CONTRADICTED_DAYS = 2;
const DEFAULT_MAX_AGE_MS = 2 * 7 * DAY_MS; // 14 days

const CACHE_FILENAME = 'payment-verdicts.json';

// ---------------------------------------------------------------------------
// loadVerdictCache
// ---------------------------------------------------------------------------

/**
 * Read `dir/payment-verdicts.json` and return its contents.
 * Fail-soft: returns `{}` if the file is missing or contains invalid JSON.
 */
export async function loadVerdictCache(dir: string): Promise<Record<string, CachedVerdict>> {
  const path = join(dir, CACHE_FILENAME);
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Record<string, CachedVerdict>;
  } catch {
    // ENOENT or JSON.parse error — both are non-fatal
    return {};
  }
}

// ---------------------------------------------------------------------------
// saveVerdictCache
// ---------------------------------------------------------------------------

/**
 * Write `cache` to `dir/payment-verdicts.json`.
 * Creates `dir` (recursively) if it does not exist.
 */
export async function saveVerdictCache(
  dir: string,
  cache: Record<string, CachedVerdict>,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CACHE_FILENAME), JSON.stringify(cache, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// isFresh
// ---------------------------------------------------------------------------

export interface VerdictTtl {
  verifiedDays?: number;
  contradictedDays?: number;
}

/**
 * Return true if the cached verdict is still within its TTL window.
 *
 * - verified      → fresh for `verifiedDays` (default 7) days.
 * - contradicted  → fresh for `contradictedDays` (default 2) days.
 * - unknown       → NEVER fresh (always returns false).
 */
export function isFresh(v: CachedVerdict, nowMs: number, ttl?: VerdictTtl): boolean {
  if (v.verdict === 'unknown') return false;

  const ageMs = nowMs - Date.parse(v.verified_at);
  if (v.verdict === 'verified') {
    const days = ttl?.verifiedDays ?? DEFAULT_VERIFIED_DAYS;
    return ageMs < days * DAY_MS;
  }
  if (v.verdict === 'contradicted') {
    const days = ttl?.contradictedDays ?? DEFAULT_CONTRADICTED_DAYS;
    return ageMs < days * DAY_MS;
  }
  return false;
}

// ---------------------------------------------------------------------------
// pruneCache
// ---------------------------------------------------------------------------

/**
 * Return a new cache object that keeps only entries satisfying BOTH:
 *   1. `seenIds.has(id)`         — the endpoint appeared in the current crawl.
 *   2. `age <= maxAgeMs`         — not older than the absolute cap (default 2×7d).
 *
 * Pure: does not mutate the input cache.
 */
export function pruneCache(
  cache: Record<string, CachedVerdict>,
  seenIds: Set<string>,
  nowMs: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): Record<string, CachedVerdict> {
  const result: Record<string, CachedVerdict> = {};
  for (const [id, entry] of Object.entries(cache)) {
    if (!seenIds.has(id)) continue;
    const ageMs = nowMs - Date.parse(entry.verified_at);
    if (ageMs > maxAgeMs) continue;
    result[id] = entry;
  }
  return result;
}
