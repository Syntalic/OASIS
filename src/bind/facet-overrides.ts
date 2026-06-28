import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EndpointRecord, FacetAction, FacetDomain } from "../core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Authored endpoint-facet overrides — the labeling workflow (scripts/gen-facet-csv.mjs → external
 *  model) emits this CSV; it is the durable, version-controlled authored layer. */
export const FACET_OVERRIDES_FILE = path.join(__dirname, "..", "..", "ontology", "endpoint-facets.csv");

export interface FacetOverride {
  action?: FacetAction;
  domain?: FacetDomain;
  output_entity?: string;
}

/** Minimal CSV reader (quoted fields + "" escapes) — labels are authored in a spreadsheet/CSV. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Load the authored facet overrides (human/model-vetted action/domain/entity), keyed by endpoint id.
 * This is the AUTHORED facet layer: it beats the regex deriver, and `facets.authored` is the only
 * thing the binding gates act on (regex facets are too noisy to gate corpus-wide — see
 * docs/proposals/binding-precision.md). Keyed by the stable endpoint id (sha256 of origin|method|path),
 * so labels carry forward across releases for unchanged endpoints. Missing file → empty map (no-op).
 */
export async function loadFacetOverrides(file = FACET_OVERRIDES_FILE): Promise<Map<string, FacetOverride>> {
  if (!existsSync(file)) return new Map();
  const rows = parseCsv(await readFile(file, "utf8"));
  if (rows.length < 2) return new Map();
  const head = rows[0];
  const ix = (name: string): number => head.indexOf(name);
  const cKey = ix("key"), cAction = ix("action"), cDomCorr = ix("domain_corrected"),
    cRegex = ix("regex_domain"), cEntity = ix("entity");
  if (cKey < 0) return new Map();
  const cell = (r: string[], i: number): string => (i >= 0 ? r[i]?.trim() ?? "" : "");
  const out = new Map<string, FacetOverride>();
  for (const r of rows.slice(1)) {
    const id = cell(r, cKey);
    if (!id) continue;
    out.set(id, {
      action: (cell(r, cAction) || undefined) as FacetAction | undefined,
      // Resolved, vetted domain: the explicit correction if any, else the reviewer-confirmed regex value.
      domain: (cell(r, cDomCorr) || cell(r, cRegex) || undefined) as FacetDomain | undefined,
      output_entity: cell(r, cEntity) || undefined,
    });
  }
  return out;
}

/**
 * Apply authored facet overrides onto endpoints (matched by stable id), AUTHORITATIVELY over the
 * regex deriver, and mark `facets.authored` so the binding gates (select-policy domain/action/entity
 * penalties) may act. A gated facet the labels do NOT provide is cleared (output_entity) so a gate
 * never fires on a raw regex value for an authored endpoint. Returns the number of endpoints updated.
 */
export function applyFacetOverrides(
  endpoints: EndpointRecord[],
  overrides: Map<string, FacetOverride>,
): number {
  if (!overrides.size) return 0;
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  let applied = 0;
  for (const [id, o] of overrides) {
    const ep = byId.get(id);
    if (!ep) continue;
    ep.facets = ep.facets ?? {};
    if (o.action) ep.facets.action = o.action;
    if (o.domain) ep.facets.domain = o.domain;
    if (o.output_entity) ep.facets.output_entity = o.output_entity;
    else delete ep.facets.output_entity; // never gate on a raw regex entity for an authored endpoint
    ep.facets.authored = true;
    applied += 1;
  }
  return applied;
}
