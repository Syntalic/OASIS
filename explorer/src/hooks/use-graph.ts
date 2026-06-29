"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

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

  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setKey = useSetAtom(graphKeyAtom);
  const setSelected = useSetAtom(selectedIdAtom);

  useEffect(() => {
    const isAsk = mode === "ask" && !!query && matches.length > 0;
    const { nodes, edges } = isAsk
      ? buildAskGraph(query, matches)
      : buildExploreGraph({ showEntities, focusDomain });
    const positioned = applyLayout(engine, nodes, edges, {
      centerId: isAsk ? "query:root" : null,
      rankdir: isAsk ? "LR" : "TB",
    });
    const key = `${mode}|${query}|${showEntities}|${focusDomain}|${engine}|${matches.length}|${relayoutNonce}`;

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
    relayoutNonce,
    setNodes,
    setEdges,
    setKey,
    setSelected,
  ]);
}
