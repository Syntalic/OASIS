import { atom } from "jotai";

import type { FindResult } from "@/types/graph";

/**
 * The live oasis_discover result for the current question — the real paid
 * endpoints + next_steps that accompany the matched capabilities. Null until a
 * query resolves (or if the MCP is unreachable and only the local fallback ran).
 */
export const findAtom = atom<FindResult | null>(null);
