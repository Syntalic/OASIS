import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHealthGate } from "./health-gate.js";

const SIDECAR = {
  hosts: {
    "https://dead.example": { verdict: "dead" },
    "https://alive.example": { verdict: "alive" },
    "https://mixed.example": { verdict: "mixed" },
  },
  dead_endpoint_ids: ["route-dead-1"],
};
const onDead = { id: "e1", origin: "https://dead.example" };
const onAlive = { id: "e2", origin: "https://alive.example" };

test("fail-soft: null sidecar disables the gate — nothing is dropped", () => {
  const g = makeHealthGate(null);
  assert.equal(g.enabled, false);
  assert.equal(g.isDead(onDead), false); // even a would-be dead-host endpoint survives
});

test("fail-soft: undefined sidecar disables the gate", () => {
  const g = makeHealthGate(undefined);
  assert.equal(g.enabled, false);
  assert.equal(g.isDead(onDead), false);
});

test("disabled flag (OASIS_HEALTH_GATE=0) forces the gate off even with a sidecar", () => {
  const g = makeHealthGate(SIDECAR, { disabled: true });
  assert.equal(g.enabled, false);
  assert.equal(g.isDead(onDead), false);
});

test("enabled gate drops endpoints on dead hosts", () => {
  const g = makeHealthGate(SIDECAR);
  assert.equal(g.enabled, true);
  assert.equal(g.isDead(onDead), true);
});

test("enabled gate keeps endpoints on alive / mixed / unknown hosts", () => {
  const g = makeHealthGate(SIDECAR);
  assert.equal(g.isDead(onAlive), false);
  assert.equal(g.isDead({ id: "e3", origin: "https://mixed.example" }), false);
  assert.equal(g.isDead({ id: "e4", origin: "https://never-probed.example" }), false);
});

test("confirmed-dead route id is dropped even on an alive host", () => {
  const g = makeHealthGate(SIDECAR);
  assert.equal(g.isDead({ id: "route-dead-1", origin: "https://alive.example" }), true);
});

test("accepts search-hit shape (endpoint_id) as well as index-record shape (id)", () => {
  const g = makeHealthGate(SIDECAR);
  assert.equal(g.isDead({ endpoint_id: "route-dead-1", origin: "https://alive.example" }), true);
  assert.equal(g.isDead({ endpoint_id: "x", origin: "https://dead.example" }), true);
});

test("endpoint with no origin and no dead id is never dead", () => {
  const g = makeHealthGate(SIDECAR);
  assert.equal(g.isDead({ id: "whatever" }), false);
});
