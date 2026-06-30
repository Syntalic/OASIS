"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { capById, matchCapabilities, type MatchResult } from "@/lib/ontology";
import { matchesAtom, modeAtom, queryAtom, searchingAtom } from "@/stores/query";

interface SearchCapability {
  intent_id: string;
}

/** Map the binder's ranked intent ids onto local capabilities + a rank-based strength. */
function toMatches(caps: SearchCapability[]): MatchResult[] {
  const out: MatchResult[] = [];
  caps.forEach((c, i) => {
    const capability = capById.get(c.intent_id);
    if (!capability) return;
    out.push({
      capability,
      score: caps.length - i,
      strength: Math.max(0.3, 1 - i * 0.1),
      hits: [],
    });
  });
  return out;
}

/**
 * Resolves the current question to ranked capabilities via the real OASIS
 * binder (`/api/search` → oasis_search), falling back to the local keyword
 * scorer if the MCP is unreachable. Runs once in the app shell.
 */
export function useAskSearch() {
  const mode = useAtomValue(modeAtom);
  const query = useAtomValue(queryAtom);
  const setMatches = useSetAtom(matchesAtom);
  const setSearching = useSetAtom(searchingAtom);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (mode !== "ask" || !query) {
        setMatches([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      let result: MatchResult[] = [];
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (res.ok) {
          const data = (await res.json()) as { capabilities?: SearchCapability[] };
          result = toMatches(data.capabilities ?? []);
        }
      } catch {
        /* network/MCP down → fall back below */
      }
      if (result.length === 0) result = matchCapabilities(query);
      if (!cancelled) {
        setMatches(result);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, query, setMatches, setSearching]);
}
