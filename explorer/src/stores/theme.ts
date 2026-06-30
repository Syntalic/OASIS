import type { ColorMode } from "@xyflow/react";
import { atom } from "jotai";

/** The resolved color mode (light | dark) the canvas should render in. */
export const colorModeAtom = atom<ColorMode>("dark");
