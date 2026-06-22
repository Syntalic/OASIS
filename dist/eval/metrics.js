/**
 * Discovery benchmark metric names (public-facing).
 *
 * - task@k    — correct capability/task intent in top-k search results
 * - discover@k — correct task intent in top-k with ≥1 materialized paid API
 *                 candidate (vendor-neutral; any matching endpoint counts)
 * - select@k   — regression anchor endpoint ranked in top-k by neutral policy
 * - literal@k — correct endpoint row directly in top-k (no resolve step)
 * - discover MRR — mean reciprocal rank for discover@k (1.0 = always rank 1)
 */
export const METRICS_LEGEND = [
    "task@k     = correct task intent in top-k",
    "discover@k = task intent in top-k with viable API candidates",
    "select@k   = anchor endpoint in top-k via neutral selection policy",
    "literal@k  = correct endpoint row directly in top-k",
    "discover MRR = mean reciprocal rank for discover@k (higher is better)",
].join("\n");
//# sourceMappingURL=metrics.js.map