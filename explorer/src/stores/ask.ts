import { atom } from "jotai";

import type { FindResult, RecommendedWorkflow } from "@/types/graph";

/**
 * The live oasis_discover result for the current question — the real paid
 * endpoints + next_steps that accompany the matched capabilities. Null until a
 * query resolves (or if the MCP is unreachable and only the local fallback ran).
 */
export const findAtom = atom<FindResult | null>(null);

/**
 * The full, unprocessed oasis_discover JSON payload for the current question —
 * surfaced verbatim in the Ask view's response inspector (the toolbar's JSON
 * button). Null until a query resolves, or if the MCP was unreachable.
 */
export const rawDiscoverAtom = atom<unknown>(null);

/**
 * The recommended workflow recipe(s) for the current question — matched multi-step
 * plans, each step resolved to a live endpoint. Empty until a query matches a recipe.
 * Rendered as the recipe card (detail panel) + the workflow node-tree on the canvas.
 */
export const recommendedWorkflowsAtom = atom<RecommendedWorkflow[]>([]);
