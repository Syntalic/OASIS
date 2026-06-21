import type { IndexBundle } from "../types.js";
import type { EvalQuery } from "./discovery-benchmark.js";
export declare function generateEvalQueries(bundle: IndexBundle, options?: {
    maxPerCapability?: number;
}): Promise<EvalQuery[]>;
