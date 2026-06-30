"use client";

import type { ColorMode } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { useTheme as useNextTheme } from "next-themes";
import { useEffect } from "react";

import { colorModeAtom } from "@/stores/theme";

/** Keeps the canvas colorMode atom in sync with next-themes' resolved theme. */
export function useThemeSync() {
  const { resolvedTheme } = useNextTheme();
  const setColorMode = useSetAtom(colorModeAtom);

  useEffect(() => {
    if (resolvedTheme === "light" || resolvedTheme === "dark") {
      setColorMode(resolvedTheme as ColorMode);
    }
  }, [resolvedTheme, setColorMode]);
}
