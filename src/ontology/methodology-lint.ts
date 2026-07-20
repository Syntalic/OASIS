/**
 * Taxonomy methodology lints (docs/taxonomy-methodology.md).
 *
 * Enforced at validate-source time so contributors can't silently re-break
 * domain placement / cross-domain note / minimum discoverability rules that
 * the current catalog already satisfies.
 */

import type { CuratedIntentSource } from "../core/types.js";

export interface MethodologyFinding {
  level: "error" | "warning";
  code:
    | "domain_prefix_mismatch"
    | "self_link"
    | "cross_domain_link_missing_note"
    | "thin_aliases"
    | "missing_description"
    | "empty_ports";
  detail: string;
}

const MIN_ALIASES = 3;

/** Extract the domain prefix of a dotted intent id (`finance.stock_quote` → `finance`). */
export function intentDomainPrefix(id: string | null | undefined): string | null {
  if (!id || !id.includes(".")) return null;
  return id.split(".")[0] ?? null;
}

/**
 * Lint one authored intent against methodology rules.
 * Pure: no I/O. `knownIds` is the full taxonomy id set (for self-link only;
 * dangling targets are handled elsewhere).
 */
export function lintMethodology(
  src: CuratedIntentSource,
  _knownIds?: Set<string>,
): MethodologyFinding[] {
  const findings: MethodologyFinding[] = [];
  const id = src.id;
  const prefix = intentDomainPrefix(id);

  // ERROR: facets.domain must match the id prefix (single-home rule is load-bearing).
  if (prefix && src.facets?.domain && src.facets.domain !== prefix) {
    findings.push({
      level: "error",
      code: "domain_prefix_mismatch",
      detail: `facets.domain "${src.facets.domain}" does not match id prefix "${prefix}" — domain is the id prefix (taxonomy-methodology single-home rule)`,
    });
  }

  // ERROR: self-links are never valid.
  for (const link of src.links ?? []) {
    if (link?.to === id) {
      findings.push({
        level: "error",
        code: "self_link",
        detail: `links[].to "${link.to}" (${link.type}) points to itself`,
      });
    }
  }

  // WARN: cross-domain typed links need a boundary note (tie-breaker rung 5).
  for (const link of src.links ?? []) {
    if (!link?.to || link.to === id) continue;
    const toPrefix = intentDomainPrefix(link.to);
    if (toPrefix && prefix && toPrefix !== prefix && !(link.note && link.note.trim())) {
      findings.push({
        level: "warning",
        code: "cross_domain_link_missing_note",
        detail: `cross-domain ${link.type} -> "${link.to}" lacks a boundary note (taxonomy-methodology: always link the runner-up with a note naming which axis differs)`,
      });
    }
  }

  // WARN: discoverability — aliases power keyword recall.
  const aliasCount = src.aliases?.length ?? 0;
  if (aliasCount < MIN_ALIASES) {
    findings.push({
      level: "warning",
      code: "thin_aliases",
      detail: `only ${aliasCount} alias(es); prefer ≥${MIN_ALIASES} natural-language phrasings for keyword recall`,
    });
  }

  if (!src.description?.trim()) {
    findings.push({
      level: "warning",
      code: "missing_description",
      detail: "missing description — agents and the binder use it for semantic routing",
    });
  }

  const hasConsumes = (src.consumes?.length ?? 0) > 0;
  const hasProduces = (src.produces?.length ?? 0) > 0;
  if (!hasConsumes && !hasProduces) {
    findings.push({
      level: "warning",
      code: "empty_ports",
      detail: "no consumes/produces ports — entity-flow chaining cannot use this intent",
    });
  }

  return findings;
}
