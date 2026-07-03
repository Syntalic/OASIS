"use client";

import { useAtomValue } from "jotai";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { rawDiscoverAtom } from "@/stores/ask";

const TOKEN = /("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * JSON syntax highlighter that emits React elements (no dangerouslySetInnerHTML).
 * Every token is rendered as a text child, so React escapes it — safe even for
 * third-party provider strings in the discover payload.
 */
function Highlighted({ value }: { value: unknown }): ReactNode {
  const json = JSON.stringify(value, null, 2) ?? "null";
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of json.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(json.slice(last, idx));
    const t = m[0];
    // darker shades in light mode, the original lighter shades in dark mode
    let cls = "text-amber-700 dark:text-amber-300/90"; // number
    if (t.startsWith('"'))
      cls = t.endsWith(":") ? "text-sky-700 dark:text-sky-300" : "text-emerald-700 dark:text-emerald-300/90";
    else if (t === "true" || t === "false") cls = "text-violet-700 dark:text-violet-300";
    else if (t === "null") cls = "text-muted-foreground";
    out.push(
      <span key={key++} className={cls}>
        {t}
      </span>,
    );
    last = idx + t.length;
  }
  if (last < json.length) out.push(json.slice(last));
  return <>{out}</>;
}

/** Quick "3 matched · 3 endpoints · 6 next" summary for the header. */
function summarize(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { endpoints?: unknown[]; next_steps?: unknown[]; matched_capabilities?: unknown[] };
  const parts: string[] = [];
  if (Array.isArray(d.matched_capabilities)) parts.push(`${d.matched_capabilities.length} matched`);
  if (Array.isArray(d.endpoints)) parts.push(`${d.endpoints.length} endpoints`);
  if (Array.isArray(d.next_steps)) parts.push(`${d.next_steps.length} next`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The Ask view's raw-response inspector — the verbatim oasis_discover JSON that
 * produced the current graph. Anchored under the toolbar in the minimap's slot.
 */
export function RawJsonPanel() {
  const data = useAtomValue(rawDiscoverAtom);
  const [copied, setCopied] = useState(false);

  const empty = data == null;
  const counts = summarize(data);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="absolute top-[calc(100%+8px)] left-0 z-10 flex w-[min(460px,calc(100vw-2rem))] flex-col rounded-xl border bg-popover/95 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Discover response
          </span>
          {counts && <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{counts}</span>}
        </div>
        <button
          onClick={copy}
          disabled={empty}
          title="Copy JSON"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {empty ? (
        <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
          Ask a question — the live <span className="font-mono text-foreground/80">oasis_discover</span> response
          appears here.
        </p>
      ) : (
        <pre className="max-h-[58vh] overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/90 [tab-size:2]">
          <Highlighted value={data} />
        </pre>
      )}
    </div>
  );
}
