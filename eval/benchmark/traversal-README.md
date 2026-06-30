# OASIS traversal (next-step) benchmark

Measures the value of `oasis_find`'s relationship layer — the "here's what you can do next" map of
adjacent/downstream capabilities — which is the dimension a **pure-vector** discovery engine
structurally cannot produce. Results + analysis:
[`docs/benchmarks/traversal-moat.md`](../../docs/benchmarks/traversal-moat.md).

## What it measures

A pure-vector engine (e.g. AgentCash) answers a query with **one ranked endpoint list** and nothing
else — it has no notion of "what comes next". For a compound, multi-step agent task ("register a
domain, host the page, email the launch"), the agent still has to discover each *subsequent*
capability on its own.

OASIS additionally surfaces those next-steps from the start capability **on a single call**, via two
key-free signals over the authored ontology:

- **(a) capability graph** — `relatedOptions(intent, bundle)`: the typed links an author wrote /
  the build inferred (`pipes_to` → next step, `sibling_of`/`alternative_of` → substitutes,
  `broader_of`/`narrower_of` → drill/generalize, `fed_by` → prior step).
- **(b) entity-flow** — `suggestFollowUps` seeded from the **bridge identity the start intent
  produces** (Domain / Company / Person / Place / ProductCategory) → other-domain capabilities that
  *consume* that identity. (Same extract→suggest path `oasis_next` runs; no `finding`, so ranking is
  structural-only — fully key-free.)

The metric, per task, is **next-step recall@K** (K=8): of the gold downstream capabilities the
workflow needs, what fraction appear in the union of (a)+(b) surfaced from the start intent. The
budget K=8 reflects a realistic `next_steps` payload.

**The contrast that is the moat:** OASIS surfaces a real fraction of the needed next-steps; a
**vector-only engine surfaces 0** — by construction, not by tuning. There is no list of relationships
in a vector index to return.

## Files

- `traversal-tasks.json` — ~18 hand-authored compound tasks: `{ id, task, start_intent,
  gold_next_intents }`. Every `intent_id` is verified against `dist/index.json` capabilities; the
  harness fails loud on an unknown id. Misses in the gold set are **genuine ≥2-hop / cross-domain**
  steps (the deeper actions an agent reaches *progressively* as it advances), not relabeled trivia —
  so the score is honest single-call coverage, not a tautology over the direct links.

## Run

Key-free — no `GOOGLE_API_KEY`, no live embedding, no LLM. Needs a built `dist/index.json` (+
`dist/entity-index.json` for the entity-flow arm; without it the harness falls back to the
capability graph alone and says so).

```bash
export OASIS_ROOT=/path/to/OASIS
node scripts/benchmark/traversal/run.mjs       # prints per-task recall@8, mean, and the 0% baseline
# TRAVERSAL_K=5 node scripts/benchmark/traversal/run.mjs   # change the next_steps budget
```

It prints a per-task table (recall@8 + the missed gold steps), the **mean recall@8**, the micro
recall (gold steps surfaced / total), and the explicit **vector-only baseline = 0%**.

## Interpreting the number

- This is **single-call** next-step coverage. The misses are mostly ≥2-hop steps that OASIS *would*
  surface on the following call (each `oasis_find`/`oasis_next` re-seeds from the agent's new current
  intent) — so per-task recall is a floor on what's reachable across the full traversal.
- `~0%` would mean the gold `intent_id`s are wrong (they'd match nothing); `~100%` would mean the
  gold set is just the direct links (trivial). A mid-range mean with spread is the healthy signal.
