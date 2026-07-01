"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { findAtom } from "@/stores/ask";
import { edgesAtom, graphKeyAtom, nodesAtom } from "@/stores/graph";
import { focusDomainAtom, layoutEngineAtom, showEntitiesAtom } from "@/stores/options";
import { matchesAtom, modeAtom, queryAtom } from "@/stores/query";
import { selectedIdAtom } from "@/stores/selection";
import { relayoutNonceAtom } from "@/stores/ui";
import { buildAskGraph, buildExploreGraph } from "@/utils/build-graph";
import { applyLayout } from "@/utils/layout";

/**
 * The single orchestrator: derives the graph from the input atoms (mode, query,
 * matches, filters, engine), runs the chosen layout, and writes the positioned
 * nodes/edges back to the store. Everything else just reads those atoms.
 */
export function useGraph() {
  const mode = useAtomValue(modeAtom);
  const query = useAtomValue(queryAtom);
  const matches = useAtomValue(matchesAtom);
  const showEntities = useAtomValue(showEntitiesAtom);
  const focusDomain = useAtomValue(focusDomainAtom);
  const engine = useAtomValue(layoutEngineAtom);
  const relayoutNonce = useAtomValue(relayoutNonceAtom);
  const find = useAtomValue(findAtom);

  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setKey = useSetAtom(graphKeyAtom);
  const setSelected = useSetAtom(selectedIdAtom);

  useEffect(() => {
    // treat as Ask as soon as there's a question, so the canvas shows the
    // question hub while the binder resolves (instead of flashing the overview)
    const isAsk = mode === "ask" && !!query;
    const built = isAsk
      ? buildAskGraph(query, matches, find ?? undefined)
      : buildExploreGraph({ showEntities, focusDomain });
    const { nodes, edges } = built;
    const positioned = applyLayout(engine, nodes, edges, {
      centerId: isAsk ? "query:root" : null,
      rankdir: isAsk ? "LR" : "TB",
    });
    const key = `${mode}|${query}|${showEntities}|${focusDomain}|${engine}|${matches.length}|${find ? find.endpoints.length : 0}|${relayoutNonce}`;

    // defer the store writes out of the effect body (keeps the canvas in sync
    // with derived inputs without a synchronous setState-in-effect)
    const raf = requestAnimationFrame(() => {
      setSelected(null);
      setEdges(edges);
      setNodes(positioned);
      setKey(key);
    });
    return () => cancelAnimationFrame(raf);
  }, [
    mode,
    query,
    matches,
    showEntities,
    focusDomain,
    engine,
    find,
    relayoutNonce,
    setNodes,
    setEdges,
    setKey,
    setSelected,
  ]);
}
