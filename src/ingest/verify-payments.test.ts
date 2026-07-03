/**
 * verify-payments.test.ts — TDD: Task 7 (verifyPayments ingest step).
 *
 * Injects `deps.probe` (a fake keyed by endpoint id) so NO real network is touched, and uses a temp
 * dir for the verdict cache. Asserts: eligible endpoints stamped from the fake; a fresh cached verdict
 * is reused (probe NOT called); a write-method endpoint stamped `unknown` without probing; the breaker
 * trips when contradicted-in-prior exceeds threshold (downgrade + `process.exitCode===1`);
 * `INGEST_NO_VERIFY` returns `merged` untouched.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { verifyPayments } from './discover.js';
import { saveVerdictCache } from './verdict-cache.js';
import type { VerifyResult } from './payment-verify.js';
import type { EndpointRecord, HttpMethod, IndexBundle, LiveChallenge } from '../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const BUILT = '2026-06-01T00:00:00.000Z';
const NOW_MS = Date.parse(BUILT);

function makeEp(o: Partial<EndpointRecord> & { id: string }): EndpointRecord {
  return {
    origin: 'https://api.example.com',
    method: 'GET' as HttpMethod,
    path: '/x',
    summary: 'test',
    payment: { paid: true, rails: [{ protocol: 'x402' }] },
    search_text: '',
    built_at: BUILT,
    ...o,
  } as EndpointRecord;
}

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'vp-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const X402_CHALLENGE: LiveChallenge[] = [
  { protocol: 'x402', accepts: [{ scheme: 'exact', network: 'base', payTo: '0xabc', amount: '1000' }] },
];

// ---------------------------------------------------------------------------
// (1) eligible endpoints stamped from the injected probe
// ---------------------------------------------------------------------------

describe('verifyPayments — stamps eligible endpoints from the probe', () => {
  it('stamps verified (+ live_challenge) and contradicted from the fake, across hosts', async () => {
    await withDir(async (dir) => {
      const merged = [
        makeEp({ id: 'A', origin: 'https://a.example' }),
        makeEp({ id: 'B', origin: 'https://b.example', payment: { paid: true, rails: [{ protocol: 'mpp' }] } }),
      ];
      const canned: Record<string, VerifyResult> = {
        A: { verdict: 'verified', reason: 'x402_challenge', challenge: X402_CHALLENGE },
        B: { verdict: 'contradicted', reason: 'served_2xx_verified_content' },
      };
      const probe = async (ep: EndpointRecord): Promise<VerifyResult> => canned[ep.id];

      const out = await verifyPayments(merged, null, dir, BUILT, { probe, nowMs: NOW_MS, schemaStore: {} });

      assert.equal(out[0].payment_verified, 'verified');
      assert.equal(out[0].payment_verified_at, BUILT);
      assert.deepEqual(out[0].payment.live_challenge, X402_CHALLENGE);
      // No prior → priorClaimedPaid 0 → breaker never trips → contradicted survives here.
      assert.equal(out[1].payment_verified, 'contradicted');
      assert.equal(out[1].payment_verified_at, BUILT);
      assert.equal(out[1].payment.live_challenge, undefined);
    });
  });
});

// ---------------------------------------------------------------------------
// (2) fresh cached verdict is reused (probe NOT called)
// ---------------------------------------------------------------------------

describe('verifyPayments — reuses a fresh cached verdict', () => {
  it('does not probe an endpoint with a fresh cached verdict', async () => {
    await withDir(async (dir) => {
      await saveVerdictCache(dir, {
        A: {
          verdict: 'verified',
          reason: 'cached_x402',
          verified_at: new Date(NOW_MS - DAY_MS).toISOString(), // 1d old → fresh (7d TTL)
          challenge: X402_CHALLENGE,
        },
      });
      let probeCalls = 0;
      const probe = async (): Promise<VerifyResult> => {
        probeCalls++;
        return { verdict: 'unknown', reason: 'should_not_run' };
      };

      const out = await verifyPayments([makeEp({ id: 'A', origin: 'https://a.example' })], null, dir, BUILT, {
        probe,
        nowMs: NOW_MS,
        schemaStore: {},
      });

      assert.equal(probeCalls, 0);
      assert.equal(out[0].payment_verified, 'verified');
      assert.deepEqual(out[0].payment.live_challenge, X402_CHALLENGE);
    });
  });
});

// ---------------------------------------------------------------------------
// (3) write-method stamped unknown without probing
// ---------------------------------------------------------------------------

describe('verifyPayments — write methods are never probed', () => {
  it('stamps a DELETE endpoint unknown without calling the probe', async () => {
    await withDir(async (dir) => {
      let called = false;
      const probe = async (): Promise<VerifyResult> => {
        called = true;
        return { verdict: 'verified', reason: 'x' };
      };

      const out = await verifyPayments(
        [makeEp({ id: 'D', method: 'DELETE' as HttpMethod, origin: 'https://d.example' })],
        null,
        dir,
        BUILT,
        { probe, nowMs: NOW_MS, schemaStore: {} },
      );

      assert.equal(called, false);
      assert.equal(out[0].payment_verified, 'unknown');
      assert.equal(out[0].payment_verified_at, BUILT);
    });
  });

  it('stamps a non-paid endpoint unknown without probing', async () => {
    await withDir(async (dir) => {
      let called = false;
      const probe = async (): Promise<VerifyResult> => {
        called = true;
        return { verdict: 'verified', reason: 'x' };
      };
      const out = await verifyPayments(
        [makeEp({ id: 'N', origin: 'https://n.example', payment: { paid: false, rails: [] } })],
        null,
        dir,
        BUILT,
        { probe, nowMs: NOW_MS, schemaStore: {} },
      );
      assert.equal(called, false);
      assert.equal(out[0].payment_verified, 'unknown');
    });
  });
});

// ---------------------------------------------------------------------------
// (4) circuit-breaker trips → downgrade + process.exitCode === 1
// ---------------------------------------------------------------------------

describe('verifyPayments — circuit-breaker', () => {
  it('trips when contradicted-in-prior exceeds threshold: downgrades + sets exitCode', async () => {
    await withDir(async (dir) => {
      const saved = process.exitCode;
      try {
        const prior = {
          endpoints: [
            makeEp({ id: 'P1', origin: 'https://p1.example' }),
            makeEp({ id: 'P2', origin: 'https://p2.example' }),
          ],
        } as unknown as IndexBundle;
        const merged = [
          makeEp({ id: 'P1', origin: 'https://p1.example' }),
          makeEp({ id: 'P2', origin: 'https://p2.example' }),
        ];
        // Contradict both prior-known ids → newlyDropped=2 / priorClaimedPaid=2 = 1.0 > 0.15 → trip.
        const probe = async (): Promise<VerifyResult> => ({
          verdict: 'contradicted',
          reason: 'served_2xx_verified_content',
        });

        const out = await verifyPayments(merged, prior, dir, BUILT, { probe, nowMs: NOW_MS, schemaStore: {} });

        assert.equal(out[0].payment_verified, 'unknown'); // downgraded
        assert.equal(out[1].payment_verified, 'unknown');
        assert.equal(process.exitCode, 1);
      } finally {
        process.exitCode = saved; // don't leak a non-zero exit into the test runner
      }
    });
  });

  it('does not trip below threshold — a lone contradiction survives', async () => {
    await withDir(async (dir) => {
      const saved = process.exitCode;
      try {
        // 10 prior claimed-paid; 1 contradicted → 1/10 = 0.1 ≤ 0.15 → no trip.
        const priorEps = Array.from({ length: 10 }, (_, i) =>
          makeEp({ id: `P${i}`, origin: `https://p${i}.example` }),
        );
        const prior = { endpoints: priorEps } as unknown as IndexBundle;
        const merged = [makeEp({ id: 'P0', origin: 'https://p0.example' })];
        const probe = async (): Promise<VerifyResult> => ({
          verdict: 'contradicted',
          reason: 'served_2xx_verified_content',
        });

        const out = await verifyPayments(merged, prior, dir, BUILT, { probe, nowMs: NOW_MS, schemaStore: {} });

        assert.equal(out[0].payment_verified, 'contradicted');
        assert.notEqual(process.exitCode, 1);
      } finally {
        process.exitCode = saved;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// (5) INGEST_NO_VERIFY → merged returned untouched
// ---------------------------------------------------------------------------

describe('verifyPayments — INGEST_NO_VERIFY kill-switch', () => {
  it('returns merged untouched (same ref, no stamping, no probe)', async () => {
    await withDir(async (dir) => {
      process.env.INGEST_NO_VERIFY = '1';
      try {
        const merged = [makeEp({ id: 'A' })];
        const probe = async (): Promise<VerifyResult> => {
          throw new Error('probe must not run under INGEST_NO_VERIFY');
        };
        const out = await verifyPayments(merged, null, dir, BUILT, { probe, nowMs: NOW_MS, schemaStore: {} });
        assert.equal(out, merged); // same reference
        assert.equal(out[0].payment_verified, undefined); // untouched
      } finally {
        delete process.env.INGEST_NO_VERIFY;
      }
    });
  });
});
