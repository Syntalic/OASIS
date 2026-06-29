import { atom } from "jotai";

import type { LayoutEngine } from "@/types/graph";

/** Explore: show the entity-flow layer. */
export const showEntitiesAtom = atom<boolean>(true);
/** Explore: focus a single domain (null = all). */
export const focusDomainAtom = atom<string | null>(null);
/** Active layout engine for the current view. */
export const layoutEngineAtom = atom<LayoutEngine>("grouped");
