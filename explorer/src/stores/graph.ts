import type { Edge, Node } from "@xyflow/react";
import { atom } from "jotai";

/** Positioned React Flow nodes/edges currently on the canvas. */
export const nodesAtom = atom<Node[]>([]);
export const edgesAtom = atom<Edge[]>([]);

/** Signature of the last built graph — changes when the canvas should refit. */
export const graphKeyAtom = atom<string>("");
