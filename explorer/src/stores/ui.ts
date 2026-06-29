import { atom } from "jotai";

export const sidebarCollapsedAtom = atom<boolean>(false);
export const showMinimapAtom = atom<boolean>(true);
export const legendOpenAtom = atom<boolean>(false);

/** Bumped to force a fresh layout pass (auto-arrange / fit reset). */
export const relayoutNonceAtom = atom<number>(0);

