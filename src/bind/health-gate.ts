// Pure health-gate verdict logic for the liveness sidecar (dist/endpoint-health.json, built by
// scripts/build-health.mjs). The server (mcp/tools.mjs) does the file I/O and passes the parsed sidecar
// here; this stays pure + unit-tested. Fail-soft is the contract: a null/absent sidecar disables the gate
// entirely (isDead → false for everything), so a missing or unreadable sidecar can never drop endpoints.

export interface HealthSidecar {
  hosts?: Record<string, { verdict?: string } | undefined>;
  dead_endpoint_ids?: string[];
}

/** Minimal endpoint shape the gate inspects — accepts both index records (`id`) and search hits (`endpoint_id`). */
export interface GateEndpoint {
  id?: string;
  endpoint_id?: string;
  origin?: string;
}

export interface HealthGate {
  /** True only when a sidecar is present AND not disabled — mirrors the server's HEALTH_GATE flag. */
  readonly enabled: boolean;
  /** True when the endpoint sits on a host verdicted "dead", or is a confirmed-dead route. */
  isDead(ep: GateEndpoint): boolean;
}

/**
 * Build a health gate from a parsed sidecar. `opts.disabled` (from OASIS_HEALTH_GATE=0) forces it off.
 * Contract: no sidecar → disabled → isDead is always false (fail-soft, never drops).
 */
export function makeHealthGate(sidecar: HealthSidecar | null | undefined, opts: { disabled?: boolean } = {}): HealthGate {
  const enabled = !!sidecar && !opts.disabled;
  const deadIds = new Set(sidecar?.dead_endpoint_ids ?? []);
  return {
    enabled,
    isDead(ep: GateEndpoint): boolean {
      if (!enabled || !sidecar) return false;
      const id = ep.id ?? ep.endpoint_id;
      if (id && deadIds.has(id)) return true;
      return ep.origin != null && sidecar.hosts?.[ep.origin]?.verdict === "dead";
    },
  };
}
