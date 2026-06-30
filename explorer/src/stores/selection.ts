import { atom } from "jotai";

/** Id of the node whose detail panel is open (null = none). */
export const selectedIdAtom = atom<string | null>(null);
