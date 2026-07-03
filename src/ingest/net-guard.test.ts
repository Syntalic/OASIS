import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, assertPublicHost } from "./net-guard.js";

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

  // Globally-routable addresses — must return true
  const publicAddrs = ["1.1.1.1", "2606:4700::1"];
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
