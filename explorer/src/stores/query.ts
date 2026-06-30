import { atom } from "jotai";

import type { MatchResult } from "@/lib/ontology";
import type { Mode } from "@/types/graph";

export const modeAtom = atom<Mode>("explore");

/** What the user is typing in the Ask box. */
export const inputAtom = atom<string>("");
/** The committed question that drives the graph. */
export const queryAtom = atom<string>("");

/**
 * Ranked capability matches for the current question. Populated by
 * useAskSearch (live OASIS binder, with a local-scorer fallback) rather than
 * derived, since the real binding is an async call.
 */
export const matchesAtom = atom<MatchResult[]>([]);

/** True while the live binder request is in flight. */
export const searchingAtom = atom<boolean>(false);
