"use client";

import { useAtom, useAtomValue } from "jotai";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ExternalLink,
  Layers,
  Loader2,
  Plug,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  capById,
  domainById,
  domainMeta,
  entityByName,
  type Capability,
} from "@/lib/ontology";
import { queryAtom } from "@/stores/query";
import { selectedIdAtom } from "@/stores/selection";

function hostOf(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function DetailPanel() {
  const [selectedId, setSelectedId] = useAtom(selectedIdAtom);
  if (!selectedId) return null;
  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <Body id={selectedId} onClose={() => setSelectedId(null)} onNavigate={setSelectedId} />
    </div>
  );
}

function Body({
  id,
  onClose,
  onNavigate,
}: {
  id: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  let header: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (id.startsWith("ent:")) ({ header, body } = entityView(id.slice(4), onNavigate));
  else if (id.startsWith("dom:")) ({ header, body } = domainView(id.slice(4), onNavigate));
  else if (id.startsWith("ep:")) ({ header, body } = endpointView(id));
  else if (id === "query:root")
    ({ header, body } = {
      header: <Head icon={<Sparkles size={14} />} kicker="Question" title="Search hub" color="var(--primary)" />,
      body: (
        <p className="text-sm text-muted-foreground">
          This node is your question. Edges flow out to the capabilities that best match it, ranked by score.
        </p>
      ),
    });
  else {
    const cap = capById.get(id);
    if (cap) ({ header, body } = capabilityView(cap, onNavigate));
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2 border-b p-4">
        {header}
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X size={15} />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">{body}</div>
      </ScrollArea>
    </>
  );
}

function Head({
  icon,
  kicker,
  title,
  color,
  subtitle,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-display flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>
        {icon}
        {kicker}
      </div>
      <h2 className="font-display mt-1 text-[15.5px] font-semibold leading-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Port({
  port,
  dir,
  onNavigate,
}: {
  port: { entity: string; role: string | null; format: string | null };
  dir: "in" | "out";
  onNavigate: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onNavigate("ent:" + port.entity)}
      className="flex w-full items-center gap-2 rounded-md border bg-secondary/40 px-2.5 py-1.5 text-left transition hover:bg-accent"
    >
      {dir === "in" ? (
        <ArrowDownToLine size={13} className="shrink-0 text-sky-400" />
      ) : (
        <ArrowUpFromLine size={13} className="shrink-0 text-emerald-400" />
      )}
      <span className="text-[12px] font-medium text-foreground">{port.entity}</span>
      <span className="ml-auto flex gap-1">
        {port.role && <Badge variant="outline" className="px-1 py-0 text-[9px]">{port.role}</Badge>}
        {port.format && <Badge variant="outline" className="px-1 py-0 text-[9px]">{port.format}</Badge>}
      </span>
    </button>
  );
}

function CapList({ ids, onNavigate, dot }: { ids: string[]; onNavigate: (id: string) => void; dot: string }) {
  return (
    <div className="space-y-1">
      {ids.map((id) => {
        const c = capById.get(id);
        if (!c) return null;
        return (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="flex w-full items-center gap-2 rounded-md border bg-secondary/30 px-2.5 py-1.5 text-left transition hover:bg-accent"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
            <span className="truncate text-[12px] text-foreground">{c.label}</span>
            <ExternalLink size={11} className="ml-auto shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

function capabilityView(cap: Capability, onNavigate: (id: string) => void) {
  const meta = domainMeta(cap.domain);
  return {
    header: (
      <Head
        icon={<Sparkles size={14} />}
        kicker={`${meta.label} · ${cap.action ?? "capability"}`}
        title={cap.label}
        color={meta.color}
        subtitle={cap.id}
      />
    ),
    body: (
      <>
        {cap.description && <p className="text-[13px] leading-relaxed text-muted-foreground">{cap.description}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => onNavigate("dom:" + cap.domain)}>
            <Badge style={{ background: meta.soft, color: meta.color, borderColor: meta.color }} className="border">
              {meta.label}
            </Badge>
          </button>
          {cap.modality.map((m) => (
            <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
          ))}
          {cap.freshness && <Badge variant="outline" className="text-[10px]">{cap.freshness}</Badge>}
        </div>
        {cap.consumes.length > 0 && (
          <Section title="Consumes">
            <div className="space-y-1.5">
              {cap.consumes.map((p) => (
                <Port key={"c" + p.entity} port={p} dir="in" onNavigate={onNavigate} />
              ))}
            </div>
          </Section>
        )}
        {cap.produces.length > 0 && (
          <Section title="Produces">
            <div className="space-y-1.5">
              {cap.produces.map((p) => (
                <Port key={"p" + p.entity} port={p} dir="out" onNavigate={onNavigate} />
              ))}
            </div>
          </Section>
        )}
        {cap.aliases.length > 0 && (
          <Section title="Also known as">
            <div className="flex flex-wrap gap-1">
              {cap.aliases.slice(0, 8).map((a) => (
                <span key={a} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{a}</span>
              ))}
            </div>
          </Section>
        )}
        <Section title={`Bound paid endpoints · ${cap.endpointCount.toLocaleString()}`}>
          {cap.topProviders.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {cap.topProviders.slice(0, 6).map((p) => (
                <span key={p.host} className="rounded-md border bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                  {p.host}
                  <span className="text-muted-foreground"> ·{p.n}</span>
                </span>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {cap.sampleEndpoints.map((e, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 font-mono text-[10px]">
                <Plug size={10} style={{ color: meta.color }} />
                <span className="font-bold" style={{ color: meta.color }}>{e.method}</span>
                <span className="truncate text-foreground/80" title={`${e.origin}${e.path}`}>
                  {hostOf(e.origin)}
                  <span className="text-muted-foreground">{e.path}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>
        <ResolveSection capId={cap.id} color={meta.color} onNavigate={onNavigate} />
      </>
    ),
  };
}

interface ResolveData {
  intent?: { id: string; label: string };
  endpoints?: Array<{
    method: string;
    target: string;
    summary?: string;
    price_usd?: number;
    inputs?: string[];
    rails?: string[];
  }>;
  related?: Array<{ type?: string; intent_id?: string; label?: string }>;
}

/** Live drill-down: oasis_resolve for this capability — real ranked endpoints + typed pivots. */
function ResolveSection({
  capId,
  color,
  onNavigate,
}: {
  capId: string;
  color: string;
  onNavigate: (id: string) => void;
}) {
  const query = useAtomValue(queryAtom);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResolveData | null>(null);
  const [error, setError] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/oasis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool: "oasis_resolve",
          args: { intent_id: capId, query: query || capId, limit: 6 },
        }),
      });
      const json = (await res.json()) as { data?: ResolveData | null };
      if (!json.data) setError(true);
      else setData(json.data);
    } catch {
      setError(true);
    }
    setLoading(false);
  };

  return (
    <Section title="Live resolve (binder)">
      {!data && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full gap-1.5 text-[11px]"
          disabled={loading}
          onClick={run}
        >
          {loading ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Resolving…
            </>
          ) : (
            <>
              <Zap size={12} /> Resolve live endpoints
            </>
          )}
        </Button>
      )}
      {error && <p className="mt-1 text-[11px] text-muted-foreground">Couldn’t reach the binder.</p>}
      {data && (
        <div className="space-y-2">
          <div className="space-y-1">
            {(data.endpoints ?? []).map((e, i) => (
              <div key={i} className="rounded-md border bg-background/60 px-2 py-1 font-mono text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold" style={{ color }}>{e.method}</span>
                  <span className="flex-1 truncate text-foreground/80" title={e.target}>{hostOf(e.target)}</span>
                  {e.price_usd != null && <span className="font-semibold" style={{ color }}>${e.price_usd}</span>}
                </div>
                {e.inputs && e.inputs.length > 0 && (
                  <div className="mt-0.5 truncate text-[9px] text-muted-foreground">in: {e.inputs.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
          {data.related && data.related.length > 0 && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pivot to</h4>
              <div className="flex flex-wrap gap-1">
                {data.related
                  .filter((r) => r.intent_id && r.label)
                  .map((r, i) => (
                    <button
                      key={i}
                      onClick={() => onNavigate(r.intent_id!)}
                      className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                      title={r.type}
                    >
                      {r.label}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function entityView(name: string, onNavigate: (id: string) => void) {
  const ent = entityByName.get(name);
  return {
    header: <Head icon={<Layers size={14} />} kicker="Entity" title={name} color="var(--muted-foreground)" />,
    body: (
      <>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Entities are the typed data that flow between capabilities. Those that <em>produce</em> {name} can feed those
          that <em>consume</em> it.
        </p>
        {ent && ent.producedBy.length > 0 && (
          <Section title={`Produced by · ${ent.producedBy.length}`}>
            <CapList ids={ent.producedBy} onNavigate={onNavigate} dot="#34d399" />
          </Section>
        )}
        {ent && ent.consumedBy.length > 0 && (
          <Section title={`Consumed by · ${ent.consumedBy.length}`}>
            <CapList ids={ent.consumedBy} onNavigate={onNavigate} dot="#38bdf8" />
          </Section>
        )}
      </>
    ),
  };
}

function domainView(domId: string, onNavigate: (id: string) => void) {
  const meta = domainMeta(domId);
  const dom = domainById.get(domId);
  return {
    header: <Head icon={<Boxes size={14} />} kicker="Domain" title={meta.label} color={meta.color} />,
    body: (
      <>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{meta.blurb}</p>
        <div className="flex gap-2">
          <Stat label="Capabilities" value={dom?.capabilities.length ?? 0} />
          <Stat label="Bound endpoints" value={dom?.endpointCount ?? 0} />
        </div>
        {dom && (
          <Section title="Capabilities">
            <CapList ids={dom.capabilities} onNavigate={onNavigate} dot={meta.color} />
          </Section>
        )}
      </>
    ),
  };
}

function endpointView(id: string) {
  const rest = id.slice(3);
  const firstColon = rest.indexOf(":");
  const capId = rest.slice(0, firstColon);
  const cap = capById.get(capId);
  const meta = cap ? domainMeta(cap.domain) : domainMeta("other");
  return {
    header: <Head icon={<Plug size={14} />} kicker="Paid endpoint" title={rest.slice(firstColon + 1)} color={meta.color} subtitle={cap?.label} />,
    body: (
      <>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          A live x402 / MPP endpoint OASIS bound to this capability. Calling it in the full index requires an inline
          micropayment.
        </p>
        {cap && (
          <div className="rounded-md border bg-secondary/40 p-2 text-[12px]">
            Satisfies <span className="font-medium text-foreground">{cap.label}</span>
          </div>
        )}
      </>
    ),
  };
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-md border bg-secondary/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums text-foreground">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
