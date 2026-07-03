import { atom } from "jotai";

export const sidebarCollapsedAtom = atom<boolean>(false);
export const showMinimapAtom = atom<boolean>(true);
export const legendOpenAtom = atom<boolean>(false);
/** Ask view: the raw discover-response JSON inspector (takes the minimap's toolbar slot). */
export const rawJsonOpenAtom = atom<boolean>(false);

/** Bumped to force a fresh layout pass (auto-arrange / fit reset). */
export const relayoutNonceAtom = atom<number>(0);

