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
});
