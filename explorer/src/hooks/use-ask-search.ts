"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect } from "react";

import { capById, matchCapabilities, type MatchResult } from "@/lib/ontology";
import { askToolAtom, findAtom } from "@/stores/ask";
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

/** capability intents (oasis_search) → ranked MatchResult[] */
function toMatches(caps: { intent_id: string }[]): MatchResult[] {
  const out: MatchResult[] = [];
  caps.forEach((c, i) => {
    const capability = capById.get(c.intent_id);
    if (capability) out.push({ capability, score: caps.length - i, strength: Math.max(0.3, 1 - i * 0.1), hits: [] });
  });
  return out;
}

/** endpoints (oasis_find) → ranked MatchResult[] of the distinct `via` capabilities */
function viaMatches(endpoints: FindEndpoint[]): MatchResult[] {
  const order: string[] = [];
  for (const e of endpoints) if (e.via && !order.includes(e.via)) order.push(e.via);
  const out: MatchResult[] = [];
  order.forEach((id, i) => {
    const capability = capById.get(id);
    if (capability) out.push({ capability, score: order.length - i, strength: Math.max(0.35, 1 - i * 0.12), hits: [] });
  });
  return out;
}

/**
 * Resolves the question through the chosen OASIS tool:
 * - capabilities → oasis_search (ranked capabilities)
 * - endpoints    → oasis_find (real endpoints + next_steps)
 * Falls back to the local keyword scorer if the MCP is unreachable.
 */
export function useAskSearch() {
  const mode = useAtomValue(modeAtom);
  const query = useAtomValue(queryAtom);
  const tool = useAtomValue(askToolAtom);
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

      let matches: MatchResult[] = [];
      let find: { endpoints: FindEndpoint[]; nextSteps: NextStep[] } | null = null;

      if (tool === "endpoints") {
        const data = await callOasis<{ endpoints?: FindEndpoint[]; next_steps?: NextStep[] }>("oasis_find", {
          query,
          limit: 24,
        });
        if (data?.endpoints?.length) {
          find = { endpoints: data.endpoints, nextSteps: data.next_steps ?? [] };
          matches = viaMatches(data.endpoints);
        }
      } else {
        const data = await callOasis<{ capabilities?: { intent_id: string }[] }>("oasis_search", {
          query,
          limit: 8,
        });
        if (data?.capabilities?.length) matches = toMatches(data.capabilities);
      }

      if (matches.length === 0) matches = matchCapabilities(query); // offline fallback

      if (!cancelled) {
        setMatches(matches);
        setFind(find);
        setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, query, tool, setMatches, setFind, setSearching]);
}
