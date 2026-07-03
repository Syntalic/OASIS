import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProbe,
  applyCircuitBreaker,
  probePaymentLiveness,
  type ProbeResponse,
  type ProbeContext,
  type Verdict,
} from './payment-verify.js';
import type { EndpointRecord, HttpMethod } from '../core/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resp(
  status: number,
  body: string,
  probedMethod = 'GET',
  headers: Record<string, string> = {},
): ProbeResponse {
  return { status, headers, body, probedMethod };
}

function ctx(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    declaredMethod: 'GET',
    rails: ['x402'],
    priceDynamic: false,
    ...overrides,
  };
}

const WELL_FORMED_402_BODY = JSON.stringify({
  accepts: [
    {
      scheme: 'exact',
      network: 'base',
      payTo: '0xABCDEF',
      amount: '1000',
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('classifyProbe', () => {
  // 1. x402 well-formed 402 → verified
  it('x402 well-formed 402 → verified', () => {
    const r = resp(402, WELL_FORMED_402_BODY);
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'verified');
    assert.ok(result.challenge);
    assert.equal(result.challenge[0].protocol, 'x402');
    assert.equal(result.challenge[0].accepts?.[0].scheme, 'exact');
  });

  // 2. accepts:[{}] → unknown (missing required fields)
  it('402 with accepts:[{}] → unknown (malformed x402)', () => {
    const r = resp(402, JSON.stringify({ accepts: [{}] }));
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /x402_malformed/);
  });

  // 3. MPP WWW-Authenticate: Payment id="a" → verified, method/intent parsed
  it('MPP WWW-Authenticate: Payment id="a" → verified', () => {
    const r = resp(402, '', 'GET', {
      'www-authenticate': 'Payment id="my-id" realm="pay-realm" method="tempo" intent="charge"',
    });
    const result = classifyProbe(r, ctx({ rails: ['mpp'] }));
    assert.equal(result.verdict, 'verified');
    assert.ok(result.challenge);
    assert.equal(result.challenge[0].protocol, 'mpp');
    assert.equal(result.challenge[0].method, 'tempo');
    assert.equal(result.challenge[0].intent, 'charge');
    assert.equal(result.challenge[0].realm, 'pay-realm');
  });

  // 4. 402 no recognizable challenge → unknown
  it('402 no recognizable challenge → unknown', () => {
    const r = resp(402, 'plain text body, not json');
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'unknown');
  });

  // 5. 200 structured-error {"error":"pay"} → unknown
  it('200 structured-error {"error":"pay"} → unknown', () => {
    const r = resp(200, JSON.stringify({ error: 'pay' }));
    const validateOutput = () => true;
    const result = classifyProbe(r, ctx({ validateOutput }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 6. 200 on substituted method (probedMethod GET, declaredMethod POST) → unknown
  it('200 on substituted method → unknown', () => {
    const r = resp(200, JSON.stringify({ id: 1, data: 'hello' }), 'GET');
    const validateOutput = () => true;
    const result = classifyProbe(
      r,
      ctx({ declaredMethod: 'POST', validateOutput }),
    );
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 7. 200 schema-matching body on declared method, non-dynamic → contradicted
  it('200 schema-matching body on declared method, non-dynamic → contradicted', () => {
    const r = resp(200, JSON.stringify({ id: 1, data: 'hello' }), 'GET');
    const validateOutput = () => true;
    const result = classifyProbe(
      r,
      ctx({ declaredMethod: 'GET', priceDynamic: false, validateOutput }),
    );
    assert.equal(result.verdict, 'contradicted');
  });

  // 8. 200 with validateOutput→false → unknown
  it('200 with validateOutput→false → unknown', () => {
    const r = resp(200, JSON.stringify({ id: 1 }), 'GET');
    const validateOutput = () => false;
    const result = classifyProbe(
      r,
      ctx({ declaredMethod: 'GET', priceDynamic: false, validateOutput }),
    );
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 9. 200 schema-less (no validateOutput) → unknown
  it('200 schema-less (no validateOutput) → unknown', () => {
    const r = resp(200, JSON.stringify({ id: 1 }), 'GET');
    const result = classifyProbe(r, ctx({ declaredMethod: 'GET', priceDynamic: false }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 10. priceDynamic:true 200 → unknown
  it('priceDynamic:true 200 → unknown', () => {
    const r = resp(200, JSON.stringify({ id: 1 }), 'GET');
    const validateOutput = () => true;
    const result = classifyProbe(
      r,
      ctx({ declaredMethod: 'GET', priceDynamic: true, validateOutput }),
    );
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 11. 401/403/429/500 → unknown
  it('401 → unknown', () => {
    const result = classifyProbe(resp(401, ''), ctx());
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /http_401/);
  });

  it('403 → unknown', () => {
    const result = classifyProbe(resp(403, ''), ctx());
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /http_403/);
  });

  it('429 → unknown', () => {
    const result = classifyProbe(resp(429, ''), ctx());
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /http_429/);
  });

  it('500 → unknown', () => {
    const result = classifyProbe(resp(500, ''), ctx());
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /http_500/);
  });

  // 12. networkError → unknown
  it('networkError → unknown', () => {
    const result = classifyProbe(
      { networkError: true, reason: 'ECONNREFUSED' },
      ctx(),
    );
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /ECONNREFUSED/);
  });

  it('networkError with no reason → unknown', () => {
    const result = classifyProbe({ networkError: true }, ctx());
    assert.equal(result.verdict, 'unknown');
  });

  // -------------------------------------------------------------------------
  // FIX 1: non-JSON / empty body must never reach contradicted
  // -------------------------------------------------------------------------

  // 17. 200 empty body with permissive validator → unknown (failed before FIX 1)
  it('200 empty body with permissive validateOutput → unknown (FIX 1)', () => {
    const r = resp(200, '', 'GET');
    const validateOutput = () => true;
    const result = classifyProbe(r, ctx({ declaredMethod: 'GET', priceDynamic: false, validateOutput }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // 18. 200 HTML body with permissive validator → unknown (failed before FIX 1)
  it('200 HTML body with permissive validateOutput → unknown (FIX 1)', () => {
    const r = resp(200, '<html>ok</html>', 'GET');
    const validateOutput = () => true;
    const result = classifyProbe(r, ctx({ declaredMethod: 'GET', priceDynamic: false, validateOutput }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // -------------------------------------------------------------------------
  // FIX 2: case-insensitive WWW-Authenticate lookup
  // -------------------------------------------------------------------------

  // 19. MPP with mixed-case header key Www-Authenticate → verified (proves FIX 2)
  it('MPP with mixed-case header key Www-Authenticate → verified (FIX 2)', () => {
    const r = resp(402, '', 'GET', {
      'Www-Authenticate': 'Payment id="a" realm="r"',
    });
    const result = classifyProbe(r, ctx({ rails: ['mpp'] }));
    assert.equal(result.verdict, 'verified');
    assert.ok(result.challenge);
    assert.equal(result.challenge[0].protocol, 'mpp');
  });

  // 20. MPP with WWW-Authenticate Bearer (wrong scheme) → unknown
  it('MPP WWW-Authenticate: Bearer → unknown (wrong scheme)', () => {
    const r = resp(402, '', 'GET', {
      'www-authenticate': 'Bearer realm="x"',
    });
    const result = classifyProbe(r, ctx({ rails: ['mpp'] }));
    assert.equal(result.verdict, 'unknown');
  });

  // -------------------------------------------------------------------------
  // FIX 3: validateOutput that throws must not escape classifyProbe
  // -------------------------------------------------------------------------

  // 21. validateOutput throwing → unknown (not an exception bubble)
  it('validateOutput that throws → unknown (FIX 3)', () => {
    const r = resp(200, JSON.stringify({ id: 1 }), 'GET');
    const validateOutput = (): boolean => { throw new Error('hostile validator'); };
    const result = classifyProbe(r, ctx({ declaredMethod: 'GET', priceDynamic: false, validateOutput }));
    assert.equal(result.verdict, 'unknown');
    assert.match(result.reason, /served_2xx_ambiguous/);
  });

  // -------------------------------------------------------------------------
  // x402 edge cases
  // -------------------------------------------------------------------------

  // 22. 402 with accepts: [] (empty array) → unknown
  it('402 with accepts:[] → unknown', () => {
    const r = resp(402, JSON.stringify({ accepts: [] }));
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'unknown');
  });

  // 23. 402 with no accepts field → unknown
  it('402 with no accepts field → unknown', () => {
    const r = resp(402, JSON.stringify({ version: '1.0' }));
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'unknown');
  });

  // 24. 402 with accepts not an array → unknown
  it('402 with accepts not-an-array → unknown', () => {
    const r = resp(402, JSON.stringify({ accepts: { scheme: 'exact', network: 'base', payTo: '0x', amount: '1' } }));
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'unknown');
  });

  // -------------------------------------------------------------------------
  // Stored accepts field-whitelist: extra keys must be stripped
  // -------------------------------------------------------------------------

  // 25. x402 verified with crafted extra field → stored entry has no evil key
  it('x402 accepts entry: extra keys are not stored on LiveAccept (whitelist)', () => {
    const crafted = JSON.stringify({
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          payTo: '0xABCDEF',
          amount: '1000',
          evil: 'injected',
        },
      ],
    });
    const r = resp(402, crafted);
    const result = classifyProbe(r, ctx({ rails: ['x402'] }));
    assert.equal(result.verdict, 'verified');
    assert.ok(result.challenge?.[0].accepts?.[0]);
    const stored = result.challenge![0].accepts![0] as Record<string, unknown>;
    assert.ok(!Object.prototype.hasOwnProperty.call(stored, 'evil'), 'evil key must not be present');
    // Whitelisted fields are present
    assert.equal(stored['scheme'], 'exact');
    assert.equal(stored['network'], 'base');
    assert.equal(stored['payTo'], '0xABCDEF');
    assert.equal(stored['amount'], '1000');
  });
});

// ---------------------------------------------------------------------------
// applyCircuitBreaker
// ---------------------------------------------------------------------------

describe('applyCircuitBreaker', () => {
  function makeVerdicts(entries: [string, Verdict][]): Map<string, Verdict> {
    return new Map(entries);
  }

  // 1. below-threshold → not tripped; drops still counted
  it('below threshold fraction → not tripped', () => {
    // 14 contradicted out of 100 prior (0.14 < 0.15)
    const priorIds = new Set(Array.from({ length: 100 }, (_, i) => `id-${i}`));
    const verdicts = makeVerdicts(
      Array.from({ length: 14 }, (_, i) => [`id-${i}`, 'contradicted']),
    );
    const result = applyCircuitBreaker(verdicts, priorIds, 100);
    assert.equal(result.tripped, false);
    assert.equal(result.newlyDropped, 14);
  });

  // 2. above fraction threshold → tripped
  it('above 0.15 fraction → tripped', () => {
    // 16 contradicted out of 100 prior (0.16 > 0.15)
    const priorIds = new Set(Array.from({ length: 100 }, (_, i) => `id-${i}`));
    const verdicts = makeVerdicts(
      Array.from({ length: 16 }, (_, i) => [`id-${i}`, 'contradicted']),
    );
    const result = applyCircuitBreaker(verdicts, priorIds, 100);
    assert.equal(result.tripped, true);
    assert.equal(result.newlyDropped, 16);
  });

  // 3. above absolute threshold → tripped
  it('above 500 absolute → tripped', () => {
    // 501 contradicted; fraction would be small (501/10000 = 0.05) but abs > 500
    const priorIds = new Set(Array.from({ length: 10000 }, (_, i) => `id-${i}`));
    const verdicts = makeVerdicts(
      Array.from({ length: 501 }, (_, i) => [`id-${i}`, 'contradicted']),
    );
    const result = applyCircuitBreaker(verdicts, priorIds, 10000);
    assert.equal(result.tripped, true);
    assert.equal(result.newlyDropped, 501);
  });

  // 4. empty prior (priorClaimedPaid === 0) → never trips (first crawl)
  it('empty prior (priorClaimedPaid=0) → never trips', () => {
    const priorIds = new Set<string>();
    const verdicts = makeVerdicts([
      ['id-new-1', 'contradicted'],
      ['id-new-2', 'contradicted'],
    ]);
    const result = applyCircuitBreaker(verdicts, priorIds, 0);
    assert.equal(result.tripped, false);
    assert.equal(result.newlyDropped, 0);
  });

  // 5. contradicted id NOT in priorIds does not count
  it('contradicted id not in priorIds is not counted', () => {
    const priorIds = new Set(['id-old-1', 'id-old-2']);
    const verdicts = makeVerdicts([
      ['id-new-1', 'contradicted'], // not in priorIds → does not count
      ['id-old-1', 'contradicted'], // in priorIds → counts
    ]);
    // priorClaimedPaid = 2; newlyDropped = 1; 1/2 = 0.5 > 0.15 → tripped
    const result = applyCircuitBreaker(verdicts, priorIds, 2);
    assert.equal(result.newlyDropped, 1);
    assert.equal(result.tripped, true);
  });

  // 6. verified/unknown ids in priorIds do not count toward newlyDropped
  it('verified/unknown ids in priorIds do not count', () => {
    const priorIds = new Set(['id-1', 'id-2', 'id-3']);
    const verdicts = makeVerdicts([
      ['id-1', 'verified'],   // in priorIds but not contradicted
      ['id-2', 'unknown'],    // in priorIds but not contradicted
      ['id-3', 'contradicted'], // in priorIds AND contradicted → counts
    ]);
    // priorClaimedPaid = 100; newlyDropped = 1; 1/100 = 0.01 < 0.15 → not tripped
    const result = applyCircuitBreaker(verdicts, priorIds, 100);
    assert.equal(result.newlyDropped, 1);
    assert.equal(result.tripped, false);
  });

  // 7. custom opts override defaults
  it('custom maxFraction and maxAbs are respected', () => {
    const priorIds = new Set(['id-1', 'id-2', 'id-3', 'id-4', 'id-5']);
    const verdicts = makeVerdicts([
      ['id-1', 'contradicted'],
      ['id-2', 'contradicted'],
    ]);
    // With default opts: 2/5 = 0.4 > 0.15 → tripped
    // With maxFraction=0.5: 0.4 < 0.5 AND 2 < 3 → not tripped
    const result = applyCircuitBreaker(verdicts, priorIds, 5, { maxFraction: 0.5, maxAbs: 3 });
    assert.equal(result.tripped, false);
    assert.equal(result.newlyDropped, 2);
  });
});

// ---------------------------------------------------------------------------
// probePaymentLiveness
// ---------------------------------------------------------------------------

describe('probePaymentLiveness', () => {
  // Minimal EndpointRecord factory. price_usd defaults to undefined → priceDynamic=true.
  // Pass { price_usd: 0.01 } when you need priceDynamic=false for the contradicted leg.
  function makeEp(method: HttpMethod, extraPayment?: { price_usd?: number }): EndpointRecord {
    return {
      id: 'probe-test-id',
      origin: 'https://api.example.com',
      method,
      path: '/v1/data',
      summary: 'Test endpoint',
      payment: { paid: true, rails: [{ protocol: 'x402' }], ...(extraPayment ?? {}) },
      search_text: 'test probe',
      built_at: '2026-01-01T00:00:00.000Z',
    };
  }

  // Well-formed x402 body (~83 chars) that classifyProbe would mark 'verified' untruncated.
  const VALID_X402 = JSON.stringify({
    accepts: [{ scheme: 'exact', network: 'base', payTo: '0xABCDEF', amount: '1000' }],
  });

  // -------------------------------------------------------------------------
  // 1. Write methods → unprobed_write_method, fetchImpl NOT invoked
  // -------------------------------------------------------------------------

  for (const method of ['DELETE', 'PUT', 'PATCH'] as HttpMethod[]) {
    it(`${method} → {unknown, unprobed_write_method}, fetchImpl not invoked`, async () => {
      let called = false;
      const fetchImpl = async (_url: string, _opts?: RequestInit): Promise<Response> => {
        called = true;
        return new Response('', { status: 200 });
      };
      const result = await probePaymentLiveness(makeEp(method), { fetchImpl });
      assert.equal(result.verdict, 'unknown');
      assert.equal(result.reason, 'unprobed_write_method');
      assert.equal(called, false, `fetchImpl must not be called for ${method}`);
    });
  }

  // -------------------------------------------------------------------------
  // 2. GET endpoint returning a 402 with well-formed x402 → verified
  // -------------------------------------------------------------------------

  it('GET endpoint whose fetchImpl returns 402 well-formed x402 → verified', async () => {
    const fetchImpl = async (_url: string, _opts?: RequestInit): Promise<Response> =>
      new Response(VALID_X402, { status: 402 });
    const result = await probePaymentLiveness(makeEp('GET'), { fetchImpl });
    assert.equal(result.verdict, 'verified');
    assert.ok(result.challenge?.[0], 'challenge must be present');
    assert.equal(result.challenge![0].protocol, 'x402');
  });

  // -------------------------------------------------------------------------
  // 3. GET returning 200 schema-matching body + resolveOutputValidator → contradicted
  // -------------------------------------------------------------------------

  it('GET returning 200 + resolveOutputValidator returning true → contradicted', async () => {
    const body = JSON.stringify({ id: 42, result: 'content' });
    const fetchImpl = async (_url: string, _opts?: RequestInit): Promise<Response> =>
      new Response(body, { status: 200 });
    // price_usd set → priceDynamic = false (all 4 legs can pass)
    const ep = makeEp('GET', { price_usd: 0.01 });
    const resolveOutputValidator = (_ep: EndpointRecord) => (_b: unknown) => true;
    const result = await probePaymentLiveness(ep, { fetchImpl, resolveOutputValidator });
    assert.equal(result.verdict, 'contradicted');
  });

  // -------------------------------------------------------------------------
  // 4. fetchImpl throws → {unknown, probe_error} — never propagates
  // -------------------------------------------------------------------------

  it('fetchImpl throwing → {unknown, probe_error} (fail-soft, error not propagated)', async () => {
    const fetchImpl = async (_url: string, _opts?: RequestInit): Promise<Response> => {
      throw new Error('ECONNREFUSED connection refused');
    };
    // Must resolve (not reject) — fail-soft
    const result = await probePaymentLiveness(makeEp('GET'), { fetchImpl });
    assert.equal(result.verdict, 'unknown');
    assert.equal(result.reason, 'probe_error');
  });

  // -------------------------------------------------------------------------
  // 5. Oversized body is truncated to bodyMax before classifyProbe
  // -------------------------------------------------------------------------

  it('body exceeding bodyMax is truncated to bodyMax before classify', async () => {
    // VALID_X402 is ~83 chars; bodyMax=20 truncates it to broken JSON → unknown
    const fetchImpl = async (_url: string, _opts?: RequestInit): Promise<Response> =>
      new Response(VALID_X402, { status: 402 });
    const result = await probePaymentLiveness(makeEp('GET'), { fetchImpl, bodyMax: 20 });
    // If truncation were skipped the full body would give 'verified'; truncation → unknown
    assert.equal(result.verdict, 'unknown');
  });
});
