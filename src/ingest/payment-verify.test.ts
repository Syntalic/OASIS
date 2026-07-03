import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProbe,
  type ProbeResponse,
  type ProbeContext,
} from './payment-verify.js';

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
