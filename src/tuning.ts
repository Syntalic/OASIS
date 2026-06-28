/**
 * Centralized tuning constants — every calibrated knob and env-gated default for binding and
 * ranking lives here, so the offline calibration harness (eval/optuna) and anyone A/B-ing the
 * ranker have a single surface to read and sweep. Values were calibrated on the dogfooding
 * battery; the deep MECHANISM rationale stays next to each consumer (the scoring functions in
 * select-policy.ts, the binder in bind-endpoints.ts). Env vars override per-shell for calibration;
 * the literals here are the shipped production defaults.
 */

/* ============================ Resolve ranking — src/bind/select-policy.ts ============================ */

/** Weight on the lexical query↔endpoint term (per-request disambiguation). */
export const DEFAULT_QUERY_WEIGHT = 10;
/** Weight on the intent label/alias vocabulary fraction (recall). */
export const DEFAULT_VOCAB_WEIGHT = 12;
/** Per-token weight on intent-id matches (the primary, dominant relevance signal). */
export const DEFAULT_ID_WEIGHT = 25;
/** Neutral quality prior — a TIEBREAKER, not a ranker: scaled well below the lexical task-fit
 *  terms. At full weight it ranked a "fake-data generator" above the real weather endpoint. */
export const DEFAULT_NEUTRAL_SCALE = 0.15;

/** Keyphrase-overlap weight (ingest-time spaCy keyphrases; serve = string match). Default 0 = off. */
export const DEFAULT_KEYPHRASE_WEIGHT = Number(process.env.OASIS_KEYPHRASE_WEIGHT ?? "0");

/** Conditional semantic-rescue weight + cosine floor. Calibrated on the dogfooding battery
 *  (60 / 0.58): catches synonym-gap rescues without boosting mis-bound noise into rank-1. */
export const DEFAULT_SEMRANK_WEIGHT = Number(process.env.OASIS_SEMRANK_WEIGHT ?? "60");
export const DEFAULT_SEMRANK_FLOOR = Number(process.env.OASIS_SEMRANK_FLOOR ?? "0.58");

/** Catch-all (host-breadth) penalty + threshold — down-weight mega-host generics crowding
 *  specialist buckets. Linear above the threshold; specialists (breadth ~1-10) are untouched. */
export const DEFAULT_BREADTH_PENALTY = Number(process.env.OASIS_BREADTH_PENALTY ?? "2.0");
export const BREADTH_THRESHOLD = Number(process.env.OASIS_BREADTH_THRESHOLD ?? "12");

/** Facet-compatibility gate penalties (domain / action / entity). Authored facets only; default
 *  0 = OFF until the labeled override set is loaded + calibrated. See docs/proposals/binding-precision.md. */
export const DEFAULT_DOMAIN_PENALTY = Number(process.env.OASIS_DOMAIN_PENALTY ?? "0");
export const DEFAULT_ACTION_PENALTY = Number(process.env.OASIS_ACTION_PENALTY ?? "0");
export const DEFAULT_ENTITY_PENALTY = Number(process.env.OASIS_ENTITY_PENALTY ?? "0");

/** Per-intent scope for the facet gates (comma-separated intent ids in OASIS_GATED_INTENTS). Empty =
 *  global, gate every intent (the calibration default — preserves the A/B harness); set = the gates
 *  fire ONLY for these validated intents. This ships the gate's proven wins (cloud.domains,
 *  travel.place_reviews) without the collateral the global gate causes on intents whose facets don't
 *  cleanly separate good from decoy (storage.file_hosting, comms.send_email). See select-policy.ts. */
export const GATED_INTENTS = new Set(
  (process.env.OASIS_GATED_INTENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

/** Weak interim structural quality weight (documented + has a real input schema). */
export const DEFAULT_QUALITY_WEIGHT = 4;
/** Price-outlier guard — deprioritize endpoints far above the candidate median. Price is a guard
 *  against the absurd, not an optimization target. */
export const DEFAULT_PRICE_OUTLIER_PENALTY = 8;

/* ============================ Hybrid search fusion — src/search/search-hybrid.ts ============================ */

/** RRF fusion weights — keyword arm vs vector arm. */
export const DEFAULT_KEYWORD_WEIGHT = 1;
export const DEFAULT_VECTOR_WEIGHT = 2;

/* ============================ Endpoint→intent binder floors — src/embed/bind-endpoints.ts ============================
 * Dense cosine floors are embedder-dependent (gemini cosines compress to ~0.78-0.82; local MiniLM
 * spreads lower). All env-overridable for the Optuna floor sweep; the binder reads each as `opts.x ?? <default>`. */

/** Dense bind floor by embedder — gemini vs local-MiniLM corpora sit at very different cosine scales. */
export const BIND_FLOOR_GEMINI = 0.78;
export const BIND_FLOOR_LOCAL = 0.45;
/** Sparse-vocabulary gating floor (TF-IDF arm) — guards binding precision. */
export const BIND_SPARSE_FLOOR = 0.035;
/** Strong-sparse promotion floor — rescues mechanics-heavy endpoints the dense floor strands;
 *  calibrated (0.12) on a full gemini run so it captures real Apify-class binds without noise. */
export const BIND_STRONG_SPARSE_FLOOR = 0.12;
/** Discrimination margin — orphan ambiguous near-ties (the spill) rather than bind weakly. */
export const BIND_DENSE_MARGIN = 0.02;
