import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, assertPublicHost, safeFetch } from "./net-guard.js";
import { fetchOpenApiForOrigin } from "./openapi-fetch.js";

describe("isPublicAddress", () => {
  // Private / loopback / link-local addresses — must all return false
  const privateAddrs = [
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
  ];
  for (const addr of privateAddrs) {
    it(`returns false for ${addr}`, () => {
      assert.equal(isPublicAddress(addr), false);
    });
  }

  // Deny-list GAPS that were live SSRF holes before the normalize-then-check rewrite.
  // Every one of these previously (wrongly) returned true.
  const leakyAddrs = [
    "198.18.0.1", // 198.18.0.0/15 benchmarking
    "192.0.0.1", // 192.0.0.0/24 IETF protocol assignments
    "192.0.2.5", // 192.0.2.0/24 TEST-NET-1
    "203.0.113.9", // 203.0.113.0/24 TEST-NET-3
    "::ffff:a00:1", // IPv4-mapped, HEX form of 10.0.0.1 (old regex missed it)
    "::ffff:a9fe:a9fe", // IPv4-mapped hex of 169.254.169.254 (cloud metadata)
    "::ffff:7f00:1", // IPv4-mapped hex of 127.0.0.1 (loopback)
    "64:ff9b::a00:1", // NAT64 64:ff9b::/96 wrapping 10.0.0.1
    "64:ff9b::a9fe:a9fe", // NAT64 wrapping 169.254.169.254 (metadata via NAT64)
    "2002:a9fe:a9fe::", // 6to4 2002::/16 wrapping 169.254.169.254 (metadata via 6to4)
    "2002:7f00:1::", // 6to4 wrapping 127.0.0.1 (loopback)
    "2001::1", // 2001:0000::/32 Teredo tunnel
    "fe9a::1", // fe80::/10 link-local (fe80–febf), missed by "fe80" prefix check
    "febf::1", // top of fe80::/10
    "0.0.0.0", // 0.0.0.0/8 this-host
    "100.64.0.1", // 100.64.0.0/10 CGNAT
    "127.5.5.5", // 127.0.0.0/8 loopback (not just .0.0.1)
    "::", // unspecified
  ];
  for (const addr of leakyAddrs) {
    it(`returns false for leaky ${addr}`, () => {
      assert.equal(isPublicAddress(addr), false);
    });
  }

  // Fail-closed: unparseable input is never public
  const junk = ["", "not-an-ip", "1.2.3", "999.1.1.1", "::ffff:zz", "1:2:3:4:5:6:7:8:9"];
  for (const addr of junk) {
    it(`returns false for unparseable ${JSON.stringify(addr)}`, () => {
      assert.equal(isPublicAddress(addr), false);
    });
  }

  // Globally-routable addresses — must return true
  const publicAddrs = ["1.1.1.1", "8.8.8.8", "2606:4700::1", "2001:4860:4860::8888"]; // last: public 2001:4860::/32, NOT Teredo
  for (const addr of publicAddrs) {
    it(`returns true for ${addr}`, () => {
      assert.equal(isPublicAddress(addr), true);
    });
  }
});

describe("assertPublicHost", () => {
  it("rejects a multi-A result that contains any private address", async () => {
    const resolver = (_h: string) => Promise.resolve(["1.2.3.4", "10.0.0.1"]);
    await assert.rejects(
      () => assertPublicHost("example.com", resolver),
      (err: Error) => {
        assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("resolves when all addresses are public", async () => {
    const resolver = (_h: string) => Promise.resolve(["1.1.1.1", "8.8.8.8"]);
    const ips = await assertPublicHost("example.com", resolver);
    assert.deepEqual(ips, ["1.1.1.1", "8.8.8.8"]);
  });

  it("rejects a numeric-decimal host whose lookup resolves to loopback", async () => {
    // 2130706433 is 127.0.0.1 in decimal; isIP returns 0 so it goes through the resolver
    const resolver = (_h: string) => Promise.resolve(["127.0.0.1"]);
    await assert.rejects(
      () => assertPublicHost("2130706433", resolver),
      (err: Error) => {
        assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("rejects a hex-form host whose lookup resolves to loopback", async () => {
    // 0x7f000001 is 127.0.0.1 in hex; isIP returns 0 so it goes through the resolver
    const resolver = (_h: string) => Promise.resolve(["127.0.0.1"]);
    await assert.rejects(
      () => assertPublicHost("0x7f000001", resolver),
      (err: Error) => {
        assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("rejects an octal-form host whose lookup resolves to loopback", async () => {
    // 017700000001 is 127.0.0.1 in octal; isIP returns 0 so it goes through the resolver
    const resolver = (_h: string) => Promise.resolve(["127.0.0.1"]);
    await assert.rejects(
      () => assertPublicHost("017700000001", resolver),
      (err: Error) => {
        assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("rejects when resolver returns an empty array", async () => {
    const resolver = (_h: string) => Promise.resolve([] as string[]);
    await assert.rejects(
      () => assertPublicHost("empty.example.com", resolver),
      (err: Error) => {
        assert.ok(err.message.includes("did not resolve"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });
});

describe("safeFetch", () => {
  // A resolver that MUST NOT be reached (proves the scheme gate short-circuits first).
  const explodingResolver = (_h: string) =>
    Promise.reject(new Error("resolver-should-not-be-called"));

  it("rejects a file:// URL at the scheme gate (no resolution, no network)", async () => {
    await assert.rejects(
      () => safeFetch("file:///etc/passwd", {}, explodingResolver),
      (err: Error) => {
        assert.ok(err.message.includes("scheme"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("rejects an ftp:// URL at the scheme gate (no resolution, no network)", async () => {
    await assert.rejects(
      () => safeFetch("ftp://ftp.example.com/x", {}, explodingResolver),
      (err: Error) => {
        assert.ok(err.message.includes("scheme"), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it("rejects a host that resolves to a private IP before any fetch", async () => {
    // If a network call were attempted, the stubbed global fetch below would explode.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch-should-not-be-called");
    }) as typeof fetch;
    try {
      const resolver = (_h: string) => Promise.resolve(["10.0.0.1"]);
      await assert.rejects(
        () => safeFetch("http://evil.example.com/", {}, resolver),
        (err: Error) => {
          assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("blocks a public→private redirect (re-vets each hop)", async () => {
    // hop0 host is public; the 302 Location points at a host that resolves to a private IP.
    const resolver = (h: string) => {
      if (h === "public.example.com") return Promise.resolve(["1.1.1.1"]);
      if (h === "internal.example.com") return Promise.resolve(["10.0.0.1"]);
      return Promise.reject(new Error(`unexpected host ${h}`));
    };
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response(null, {
        status: 302,
        headers: { location: "http://internal.example.com/" },
      });
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => safeFetch("http://public.example.com/", {}, resolver),
        (err: Error) => {
          assert.ok(err.message.includes("not public"), `unexpected message: ${err.message}`);
          return true;
        },
      );
      // Only hop0 hit the network; the redirect target was rejected before hop1's fetch.
      assert.equal(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("fetchOpenApiForOrigin SSRF guard", () => {
  it("returns empty endpoints and never hits the network when origin resolves to a private IP", async () => {
    // Inject a resolver that returns a private address — safeFetch must throw before any
    // real network call is made (assertPublicHost rejects, so fetch is never invoked).
    const resolver = (_h: string) => Promise.resolve(["10.0.0.1"]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch-should-not-be-called");
    }) as typeof fetch;
    try {
      const { endpoints } = await fetchOpenApiForOrigin(
        "http://evil.internal",
        "2026-01-01T00:00:00.000Z",
        1000,
        resolver,
      );
      // All OPENAPI_PATHS candidates fail-soft (safeFetch throws → caught → try next → all exhausted).
      assert.deepEqual(endpoints, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns empty endpoints when origin resolves to loopback (127.x)", async () => {
    const resolver = (_h: string) => Promise.resolve(["127.0.0.1"]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("fetch-should-not-be-called");
    }) as typeof fetch;
    try {
      const { endpoints } = await fetchOpenApiForOrigin(
        "http://localhost",
        "2026-01-01T00:00:00.000Z",
        1000,
        resolver,
      );
      assert.deepEqual(endpoints, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
