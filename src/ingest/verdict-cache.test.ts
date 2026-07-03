/**
 * verdict-cache.test.ts — TDD: Task 5
 * Tests: isFresh (asymmetric TTL), pruneCache, loadVerdictCache (missing file), round-trip write/read.
 * No network; uses node:os + node:fs/promises for temp dir only.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  isFresh,
  pruneCache,
  loadVerdictCache,
  saveVerdictCache,
  type CachedVerdict,
} from './verdict-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function makeEntry(
  verdict: CachedVerdict['verdict'],
  agoMs: number,
  nowMs: number,
): CachedVerdict {
  return {
    verdict,
    reason: 'test',
    verified_at: new Date(nowMs - agoMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// isFresh
// ---------------------------------------------------------------------------

describe('isFresh — verified (default 7d TTL)', () => {
  const nowMs = Date.now();

  it('is fresh when 6 days old', () => {
    assert.equal(isFresh(makeEntry('verified', 6 * DAY_MS, nowMs), nowMs), true);
  });

  it('is fresh at exactly 7 days minus 1ms', () => {
    assert.equal(isFresh(makeEntry('verified', 7 * DAY_MS - 1, nowMs), nowMs), true);
  });

  it('is stale at exactly 7 days', () => {
    assert.equal(isFresh(makeEntry('verified', 7 * DAY_MS, nowMs), nowMs), false);
  });

  it('is stale when 8 days old', () => {
    assert.equal(isFresh(makeEntry('verified', 8 * DAY_MS, nowMs), nowMs), false);
  });
});

describe('isFresh — contradicted (default 2d TTL)', () => {
  const nowMs = Date.now();

  it('is fresh when 1 day old', () => {
    assert.equal(isFresh(makeEntry('contradicted', 1 * DAY_MS, nowMs), nowMs), true);
  });

  it('is fresh at 2 days minus 1ms', () => {
    assert.equal(isFresh(makeEntry('contradicted', 2 * DAY_MS - 1, nowMs), nowMs), true);
  });

  it('is stale at exactly 2 days', () => {
    assert.equal(isFresh(makeEntry('contradicted', 2 * DAY_MS, nowMs), nowMs), false);
  });

  it('is stale when 3 days old', () => {
    assert.equal(isFresh(makeEntry('contradicted', 3 * DAY_MS, nowMs), nowMs), false);
  });
});

describe('isFresh — unknown (never fresh)', () => {
  const nowMs = Date.now();

  it('is never fresh even if 1 second old', () => {
    assert.equal(isFresh(makeEntry('unknown', 1_000, nowMs), nowMs), false);
  });

  it('is never fresh even if brand new (0ms ago)', () => {
    assert.equal(isFresh(makeEntry('unknown', 0, nowMs), nowMs), false);
  });
});

describe('isFresh — custom TTL overrides', () => {
  const nowMs = Date.now();

  it('verified: respects custom verifiedDays=3', () => {
    const v = makeEntry('verified', 2 * DAY_MS, nowMs);
    assert.equal(isFresh(v, nowMs, { verifiedDays: 3 }), true);
    const stale = makeEntry('verified', 4 * DAY_MS, nowMs);
    assert.equal(isFresh(stale, nowMs, { verifiedDays: 3 }), false);
  });

  it('contradicted: respects custom contradictedDays=5', () => {
    const v = makeEntry('contradicted', 4 * DAY_MS, nowMs);
    assert.equal(isFresh(v, nowMs, { contradictedDays: 5 }), true);
    const stale = makeEntry('contradicted', 6 * DAY_MS, nowMs);
    assert.equal(isFresh(stale, nowMs, { contradictedDays: 5 }), false);
  });
});

// ---------------------------------------------------------------------------
// pruneCache
// ---------------------------------------------------------------------------

describe('pruneCache', () => {
  const nowMs = Date.now();
  const maxAgeMs = 2 * 7 * DAY_MS; // 14d default

  const cache: Record<string, CachedVerdict> = {
    seen_fresh: { verdict: 'verified', reason: 'ok', verified_at: new Date(nowMs - DAY_MS).toISOString() },
    seen_old: { verdict: 'verified', reason: 'ok', verified_at: new Date(nowMs - 15 * DAY_MS).toISOString() },
    unseen_fresh: { verdict: 'contradicted', reason: 'lie', verified_at: new Date(nowMs - DAY_MS).toISOString() },
    unseen_old: { verdict: 'contradicted', reason: 'lie', verified_at: new Date(nowMs - 20 * DAY_MS).toISOString() },
  };

  const seenIds = new Set(['seen_fresh', 'seen_old']);
  const result = pruneCache(cache, seenIds, nowMs, maxAgeMs);

  it('keeps entries that are seen AND within maxAge', () => {
    assert.ok('seen_fresh' in result);
  });

  it('removes entries that are seen but OLDER than maxAge', () => {
    assert.ok(!('seen_old' in result));
  });

  it('removes entries not in seenIds (even if fresh)', () => {
    assert.ok(!('unseen_fresh' in result));
  });

  it('removes entries that are unseen AND old', () => {
    assert.ok(!('unseen_old' in result));
  });

  it('returns a new object (does not mutate input)', () => {
    assert.notEqual(result, cache);
    assert.ok('unseen_fresh' in cache); // original untouched
  });

  it('uses default maxAgeMs (2×7d) when not provided', () => {
    const r2 = pruneCache(cache, seenIds, nowMs);
    assert.ok('seen_fresh' in r2);
    assert.ok(!('seen_old' in r2)); // 15d > 14d default
  });
});

// ---------------------------------------------------------------------------
// loadVerdictCache — missing file → {}
// ---------------------------------------------------------------------------

describe('loadVerdictCache', () => {
  it('returns {} for a directory with no payment-verdicts.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vc-test-'));
    try {
      const result = await loadVerdictCache(dir);
      assert.deepEqual(result, {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns {} for a file with invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vc-test-'));
    try {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(dir, 'payment-verdicts.json'), 'NOT JSON {{{{');
      const result = await loadVerdictCache(dir);
      assert.deepEqual(result, {});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip: saveVerdictCache → loadVerdictCache
// ---------------------------------------------------------------------------

describe('round-trip write/read', () => {
  it('preserves all entries after save + load', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vc-test-'));
    try {
      const nowMs = Date.now();
      const cache: Record<string, CachedVerdict> = {
        ep1: {
          verdict: 'verified',
          reason: 'x402_well_formed',
          verified_at: new Date(nowMs - DAY_MS).toISOString(),
          challenge: [{ protocol: 'x402', accepts: [{ scheme: 'exact', payTo: '0xabc', amount: '1000' }] }],
        },
        ep2: {
          verdict: 'contradicted',
          reason: 'served_free',
          verified_at: new Date(nowMs - 3600_000).toISOString(),
        },
      };

      await saveVerdictCache(dir, cache);
      const loaded = await loadVerdictCache(dir);

      assert.deepEqual(loaded, cache);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('saveVerdictCache creates the directory if it does not exist', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vc-test-'));
    const dir = join(base, 'nested', 'deep');
    try {
      await saveVerdictCache(dir, {});
      const loaded = await loadVerdictCache(dir);
      assert.deepEqual(loaded, {});
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
