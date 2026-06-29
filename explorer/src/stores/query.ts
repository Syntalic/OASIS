import { atom } from "jotai";

import { matchCapabilities } from "@/lib/ontology";
import type { Mode } from "@/types/graph";

export const modeAtom = atom<Mode>("explore");

/** What the user is typing in the Ask box. */
export const inputAtom = atom<string>("");
/** The committed question that drives the graph. */
export const queryAtom = atom<string>("");

/** Ranked capability matches for the current question (empty unless asking). */
export const matchesAtom = atom((get) => {
  const mode = get(modeAtom);
  const query = get(queryAtom);
  return mode === "ask" && query ? matchCapabilities(query) : [];
});
