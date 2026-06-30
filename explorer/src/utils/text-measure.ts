/**
 * Canvas-based text measurement so the layout engine knows each node's real
 * footprint *before* layout (ported from OpenMetadata's OntologyExplorer).
 * This is the correct fix for node-overlap: size nodes from their label, then
 * feed exact dimensions to dagre/grid layouts.
 */

let sharedCtx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!sharedCtx) sharedCtx = document.createElement("canvas").getContext("2d");
  return sharedCtx;
}

const FALLBACK_CHAR = 7.2;

export function measureTextWidth(text: string, font: string): number {
  const c = ctx();
  if (!c) return text.length * FALLBACK_CHAR;
  try {
    c.font = font;
    return Math.ceil(c.measureText(text).width);
  } catch {
    return text.length * FALLBACK_CHAR;
  }
}

/**
 * Estimate the rendered height of a label wrapped to `maxWidth`, given a single
 * line height. Used to size capability cards whose titles wrap.
 */
export function measureWrappedLines(
  text: string,
  font: string,
  maxWidth: number,
): number {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 1;
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measureTextWidth(candidate, font) > maxWidth && line) {
      lines += 1;
      line = w;
    } else {
      line = candidate;
    }
  }
  return lines;
}
