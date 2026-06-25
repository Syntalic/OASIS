import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { relatedOptions } from "./related.js";
import type { CapabilityIntent, IndexBundle } from "../core/types.js";

function cap(
  id: string,
  label: string,
  links: CapabilityIntent["links"] = [],
): CapabilityIntent {
  return { id, label, links, satisfies: [] };
}

const bundle: IndexBundle = {
  index_version: "test",
  spec_version: "test",
  built_at: "2026-01-01T00:00:00.000Z",
  sources: [],
  stats: { providers: 0, endpoints: 0, capabilities: 4, origins: 0 },
  endpoints: [],
  capabilities: [
    cap("a.x", "X", [
      { type: "sibling_of", to: "a.w" },
      { type: "broader_of", to: "a.y" },
      { type: "alternative_of", to: "a.z" },
      { type: "broader_of", to: "a.y" }, // duplicate target — should dedupe
      { type: "sibling_of", to: "missing" }, // dangling — should drop
    ]),
    cap("a.y", "Y narrower"),
    cap("a.z", "Z alternative"),
    cap("a.w", "W sibling"),
  ],
};

describe("relatedOptions", () => {
  it("returns typed neighbors, ordered, deduped, dangling dropped", () => {
    const opts = relatedOptions(bundle.capabilities[0], bundle);
    assert.equal(opts.length, 3, JSON.stringify(opts));
    // ordered: alternative_of, broader_of, sibling_of
    assert.deepEqual(
      opts.map((o) => o.intent_id),
      ["a.z", "a.y", "a.w"],
    );
    assert.equal(opts[0].relation_label, "alternative");
    // broader_of link => target is the MORE SPECIFIC option
    assert.equal(opts[1].relation, "broader_of");
    assert.equal(opts[1].relation_label, "more specific");
    assert.equal(opts[2].relation_label, "related");
  });

  it("returns [] for an intent with no links", () => {
    assert.deepEqual(relatedOptions(bundle.capabilities[1], bundle), []);
  });

  it("labels pipes_to / fed_by as next / prior step", () => {
    const b: IndexBundle = {
      ...bundle,
      capabilities: [
        cap("p.a", "Producer", [{ type: "pipes_to", to: "p.b" }]),
        cap("p.b", "Consumer", [{ type: "fed_by", to: "p.a" }]),
      ],
    };
    assert.equal(relatedOptions(b.capabilities[0], b)[0].relation_label, "next step");
    assert.equal(relatedOptions(b.capabilities[1], b)[0].relation_label, "prior step");
  });
});
