import { atom } from "jotai";

import type { AskTool, FindResult } from "@/types/graph";

/** Which OASIS tool the Ask tab runs the question through. */
export const askToolAtom = atom<AskTool>("capabilities");

/** Live oasis_find result (endpoints + next_steps); null in capabilities mode. */
export const findAtom = atom<FindResult | null>(null);
