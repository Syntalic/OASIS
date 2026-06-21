/**
 * Discovery benchmark metric names (public-facing).
 *
 * - task@k    — correct capability/task intent in top-k search results
 * - discover@k — correct paid API via search → resolve in top-k
 *                 (intent hit counts if it resolves to the expected endpoint)
 * - literal@k — correct endpoint row directly in top-k (no resolve step)
 * - discover MRR — mean reciprocal rank for discover@k (1.0 = always rank 1)
 */
export declare const METRICS_LEGEND: string;
