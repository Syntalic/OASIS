import type { Node } from "@xyflow/react";

import { adaptiveSpacing, getNodeSize } from "@/utils/layout/sizes";

type Pos = { x: number; y: number };

/**
 * Domain-grouped clusters (ported & adapted from OpenMetadata's
 * computeGlossaryGroupPositions): capabilities are tiled in a grid under their
 * domain header; entities form their own cluster; clusters are arranged in a
 * macro-grid sized to the widest cluster.
 */
export function groupedLayout(nodes: Node[]): Map<string, Pos> {
  const scale = nodes.length > 60 ? 0.85 : 1;
  const GAP = adaptiveSpacing(28, nodes.length) * scale;
  const HEADER_GAP = 18;
  const PAD = 26;
  const MACRO_GAP = adaptiveSpacing(72, nodes.length);

  const groupKey = (n: Node): string => {
    const d = n.data as { kind?: string; domain?: string; domainId?: string };
    if (d.kind === "domain") return `dom:${d.domainId}`;
    if (d.kind === "capability") return `dom:${d.domain}`;
    if (d.kind === "entity") return "__entities";
    return "__misc";
  };

  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const k = groupKey(n);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(n);
  }

  interface Box {
    local: Map<string, Pos>;
    width: number;
    height: number;
  }

  const boxes: { key: string; box: Box }[] = [];

  for (const [key, members] of groups) {
    const header = members.find(
      (n) => (n.data as { kind?: string }).kind === "domain",
    );
    const items = members.filter((n) => n !== header);

    const local = new Map<string, Pos>();
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
    const cellW = Math.max(1, ...items.map((n) => getNodeSize(n)[0])) + GAP;
    const cellH = Math.max(1, ...items.map((n) => getNodeSize(n)[1])) + GAP;

    const headerH = header ? getNodeSize(header)[1] + HEADER_GAP : 0;
    const gridW = cols * cellW - GAP;

    items.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      local.set(n.id, { x: col * cellW, y: headerH + row * cellH });
    });

    if (header) {
      const [hw] = getNodeSize(header);
      local.set(header.id, { x: Math.max(0, (gridW - hw) / 2), y: 0 });
    }

    const rows = Math.max(1, Math.ceil(items.length / cols));
    const width = Math.max(gridW, header ? getNodeSize(header)[0] : 0);
    const height = headerH + rows * cellH - GAP;
    boxes.push({ key, box: { local, width, height } });
  }

  // macro-grid of cluster boxes — per-column widths and per-row heights so a
  // single wide cluster (e.g. a 23-capability domain) doesn't force every
  // column wide and blow the whole map out horizontally.
  // bias toward fewer columns so the map fills vertically rather than sprawling
  // into a wide, short band that fitView has to shrink
  const macroCols = Math.max(1, Math.round(Math.sqrt(boxes.length * 0.6)));
  const numRows = Math.ceil(boxes.length / macroCols);
  const colW = new Array(macroCols).fill(0) as number[];
  const rowH = new Array(numRows).fill(0) as number[];
  boxes.forEach((b, i) => {
    const c = i % macroCols;
    const r = Math.floor(i / macroCols);
    colW[c] = Math.max(colW[c], b.box.width + PAD * 2);
    rowH[r] = Math.max(rowH[r], b.box.height + PAD * 2);
  });
  const colX = new Array(macroCols).fill(0) as number[];
  for (let c = 1; c < macroCols; c++) colX[c] = colX[c - 1] + colW[c - 1] + MACRO_GAP;
  const rowY = new Array(numRows).fill(0) as number[];
  for (let r = 1; r < numRows; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + MACRO_GAP;

  const out = new Map<string, Pos>();
  boxes.forEach((b, i) => {
    const c = i % macroCols;
    const r = Math.floor(i / macroCols);
    const ox = colX[c] + PAD;
    const oy = rowY[r] + PAD;
    for (const [id, p] of b.box.local) out.set(id, { x: ox + p.x, y: oy + p.y });
  });
  return out;
}
