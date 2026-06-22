import type { CapabilityIntent, IndexBundle } from "./types.js";
/**
 * Materialize the 47 curated task intents against the live endpoint index.
 * Used at search/eval time so discovery works even when dist/index.json was
 * built before intent-match materialization covered every curated intent.
 */
export declare function curatedCapabilitiesForSearch(bundle: IndexBundle, intentsDir?: string): CapabilityIntent[];
