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
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

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
import { recommendedWorkflowsAtom } from "@/stores/ask";
import { queryAtom } from "@/stores/query";
import { selectedIdAtom } from "@/stores/selection";
import type { RecommendedWorkflow, RecommendedWorkflowStep } from "@/types/graph";

const WF_COLOR = "#f59e0b";

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
  const workflows = useAtomValue(recommendedWorkflowsAtom);
  let header: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (id.startsWith("ent:")) ({ header, body } = entityView(id.slice(4), onNavigate));
  else if (id.startsWith("dom:")) ({ header, body } = domainView(id.slice(4), onNavigate));
  else if (id.startsWith("ep:")) ({ header, body } = endpointView(id));
  else if (id.startsWith("wf:") && id.includes(":step:")) {
    const m = id.slice(3).match(/^(.*):step:(\d+)$/);
    const wf = m ? workflows.find((w) => w.id === m[1]) : undefined;
    const step = wf?.steps.find((s) => s.n === Number(m?.[2]));
    if (wf && step) ({ header, body } = workflowStepView(wf, step, onNavigate));
  } else if (id.startsWith("wf:")) {
    const wf = workflows.find((w) => w.id === id.slice(3));
    if (wf) ({ header, body } = workflowView(wf, onNavigate));
  } else if (id === "query:root")
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

function workflowView(wf: RecommendedWorkflow, onNavigate: (id: string) => void) {
  return {
    header: (
      <Head
        icon={<Workflow size={14} />}
        kicker={`Workflow · ${wf.shape}`}
        title={wf.goal}
        color={WF_COLOR}
        subtitle={`${Math.round(wf.match_score * 100)}% match · $${wf.total_price_usd} · ${wf.steps.length} steps`}
      />
    ),
    body: (
      <>
        <Section title="Recipe — steps">
          <div className="space-y-1.5">
            {wf.steps.map((step) => {
              const cap = capById.get(step.intent_id);
              return (
                <button
                  key={step.n}
                  onClick={() => onNavigate(`wf:${wf.id}:step:${step.n}`)}
                  className="flex w-full items-start gap-2 rounded-md border bg-secondary/30 px-2.5 py-1.5 text-left transition hover:bg-accent"
                >
                  <span
                    className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold tabular-nums"
                    style={{ background: `color-mix(in oklab, ${WF_COLOR} 22%, transparent)`, color: WF_COLOR }}
                  >
                    {step.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium text-foreground">{cap?.label ?? step.intent_id}</span>
                      {step.optional && <Badge variant="outline" className="px-1 py-0 text-[9px]">optional</Badge>}
                      {step.gate && (
                        <Badge variant="outline" className="px-1 py-0 text-[9px]" style={{ color: WF_COLOR, borderColor: WF_COLOR }}>gate</Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{step.do}</span>
                    {step.endpoint && (
                      <span className="mt-0.5 flex items-center gap-1 font-mono text-[9.5px] text-foreground/70">
                        <Plug size={9} className="shrink-0" />
                        <span className="truncate">{hostOf(step.endpoint.url)}</span>
                        {step.endpoint.price_usd != null && (
                          <span className="ml-auto shrink-0 font-bold" style={{ color: WF_COLOR }}>${step.endpoint.price_usd}</span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Produces">
          <p className="text-[12px] leading-snug text-muted-foreground">{wf.produces}</p>
        </Section>
        <p className="rounded-md border border-dashed bg-secondary/30 px-2.5 py-1.5 text-[10.5px] leading-snug text-muted-foreground">
          OASIS suggests this route; your agent executes it. Each step resolves to a fresh endpoint every call.
        </p>
      </>
    ),
  };
}

function workflowStepView(
  wf: RecommendedWorkflow,
  step: RecommendedWorkflowStep,
  onNavigate: (id: string) => void,
) {
  const cap = capById.get(step.intent_id);
  const ep = step.endpoint;
  return {
    header: (
      <Head
        icon={<Workflow size={14} />}
        kicker={`Step ${step.n} of ${wf.steps.length}`}
        title={cap?.label ?? step.intent_id}
        color={WF_COLOR}
        subtitle={step.intent_id}
      />
    ),
    body: (
      <>
        <p className="text-[12px] leading-snug text-muted-foreground">{step.do}</p>
        {step.gate && (
          <div className="rounded-md border px-2.5 py-1.5 text-[11px] leading-snug" style={{ borderColor: WF_COLOR, color: WF_COLOR }}>
            ⚠ Gate — {step.gate}
          </div>
        )}
        {ep ? (
          <Section title="Resolved endpoint">
            <div className="rounded-md border bg-secondary/40 px-2.5 py-2 font-mono text-[11px]">
              <div className="flex items-center gap-1.5">
                <Plug size={11} style={{ color: WF_COLOR }} />
                <span className="font-bold">{ep.method}</span>
                <span className="truncate" title={ep.url}>{hostOf(ep.url)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{ep.price_usd != null ? `$${ep.price_usd}` : ""}</span>
                <span className="uppercase">{ep.rails?.join(" · ")}</span>
              </div>
            </div>
          </Section>
        ) : (
          <p className="text-[11px] italic text-muted-foreground">No live endpoint resolved for this step.</p>
        )}
        <div className="flex flex-col gap-1 pt-1">
          {cap && (
            <button onClick={() => onNavigate(step.intent_id)} className="text-left text-[11px] text-primary hover:underline">
              View the {cap.label} capability →
            </button>
          )}
          <button onClick={() => onNavigate(`wf:${wf.id}`)} className="text-left text-[11px] text-muted-foreground hover:underline">
            ← Back to the workflow
          </button>
        </div>
      </>
    ),
  };
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

/**
 * Auto-loaded oasis_resolve for the focused capability — real ranked endpoints
 * (with inputs) + typed pivots (next-step / prior-step / alternatives). Shown
 * automatically since these are capability-scoped (oasis_next/resolve need a
 * starting intent, so they live here rather than on the query toggle).
 */
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(false);
      setData(null);
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
        if (!cancelled) {
          if (json.data) setData(json.data);
          else setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [capId, query]);

  return (
    <Section title="Live resolve (binder)">
      {loading && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 size={12} className="animate-spin" /> Resolving live endpoints…
        </p>
      )}
      {error && !loading && (
        <p className="text-[11px] text-muted-foreground">Couldn’t reach the binder (bound endpoints shown above).</p>
      )}
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
