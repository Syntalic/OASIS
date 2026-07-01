"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { capById, matchCapabilities, type MatchResult } from "@/lib/ontology";
import { findAtom } from "@/stores/ask";
import { matchesAtom, modeAtom, queryAtom, searchingAtom } from "@/stores/query";
import type { FindEndpoint, NextStep } from "@/types/graph";

async function callOasis<T>(tool: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch("/api/oasis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, args }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T | null };
    return json.data ?? null;
  } catch {
    return null;
  }
}

/** matched_capabilities → ranked MatchResult[]. discover returns no score, so
 *  strength is derived from rank position. */
function toMatches(caps: { intent_id: string }[]): MatchResult[] {
  const out: MatchResult[] = [];
  caps.forEach((c, i) => {
    const capability = capById.get(c.intent_id);
    if (capability) out.push({ capability, score: caps.length - i, strength: Math.max(0.3, 1 - i * 0.1), hits: [] });
  });
  return out;
}

/** The full oasis_discover payload — the superset of the other tools. */
interface DiscoverResult {
  matched_capabilities?: { intent_id: string; label?: string }[];
  endpoints?: FindEndpoint[];
  next_steps?: NextStep[];
}

/**
 * Resolves the question through OASIS `oasis_discover` — the single call that
 * returns everything: matched capabilities + real paid endpoints + next steps.
 * Falls back to the local keyword scorer for the capability list if the MCP is
 * unreachable (endpoints / next steps then stay empty).
 */
export function useAskSearch() {
  const mode = useAtomValue(modeAtom);
  const query = useAtomValue(queryAtom);
  const setMatches = useSetAtom(matchesAtom);
  const setFind = useSetAtom(findAtom);
  const setSearching = useSetAtom(searchingAtom);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (mode !== "ask" || !query) {
        setMatches([]);
        setFind(null);
        setSearching(false);
        return;
      }
      setSearching(true);

      const data = await callOasis<DiscoverResult>("oasis_discover", { query });

      let matches = toMatches(data?.matched_capabilities ?? []);
      if (matches.length === 0) matches = matchCapabilities(query); // offline fallback
      const find =
        data?.endpoints?.length || data?.next_steps?.length
          ? { endpoints: data.endpoints ?? [], nextSteps: data.next_steps ?? [] }
          : null;

      if (!cancelled) {
        setMatches(matches);
        setFind(find);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, query, setMatches, setFind, setSearching]);
}
