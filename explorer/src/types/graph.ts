/** View-layer types for the React Flow graph (distinct from the ontology data model). */

export type NodeKind = "domain" | "capability" | "entity" | "query" | "endpoint";

export type EdgeKind =
  | "membership" // capability → domain
  | "consumes" // entity → capability
  | "produces" // capability → entity
  | "match" // question → capability
  | "serves"; // capability → endpoint

export type Mode = "explore" | "ask";

/** Which OASIS tool the Ask tab runs the question through. */
export type AskTool = "capabilities" | "endpoints";

export type LayoutEngine = "grouped" | "layered" | "radial";

/** oasis_find result shapes. */
export interface FindEndpoint {
  method: string;
  url: string;
  summary?: string;
  price_usd?: number;
  rails?: string[];
  via: string; // capability intent id
}
export interface NextStep {
  intent_id: string;
  do: string;
  why: string;
  endpoint?: string;
  price_usd?: number;
}
export interface FindResult {
  endpoints: FindEndpoint[];
  nextSteps: NextStep[];
}

/** Per-relation styling, à la OpenMetadata's RELATION_META. */
export const RELATION_META: Record<EdgeKind, { label: string }> = {
  membership: { label: "in domain" },
  consumes: { label: "consumes" },
  produces: { label: "produces" },
  match: { label: "matches" },
  serves: { label: "served by" },
};

interface CommonNodeData {
  /** text-measured [width, height] fed to the layout engine */
  size?: [number, number];
  /** part of the traced/selected set */
  highlight?: boolean;
  /** dimmed because something else is traced */
  faded?: boolean;
}

export interface DomainNodeData extends CommonNodeData {
  kind: "domain";
  domainId: string;
  label: string;
  color: string;
  capCount: number;
  endpointCount: number;
}

export interface CapabilityNodeData extends CommonNodeData {
  kind: "capability";
  capId: string;
  label: string;
  domain: string;
  color: string;
  action: string | null;
  modality: string[];
  endpointCount: number;
  strength?: number;
  rank?: number;
  /** a chain-to suggestion from oasis_find.next_steps */
  nextStep?: boolean;
  why?: string;
}

export interface EntityNodeData extends CommonNodeData {
  kind: "entity";
  name: string;
  degree: number;
}

export interface QueryNodeData extends CommonNodeData {
  kind: "query";
  text: string;
  count: number;
}

export interface EndpointNodeData extends CommonNodeData {
  kind: "endpoint";
  host: string;
  method: string;
  path: string;
  color: string;
  capId: string;
  /** present for live oasis_find endpoints */
  price?: number;
  rails?: string[];
}

export type AnyNodeData =
  | DomainNodeData
  | CapabilityNodeData
  | EntityNodeData
  | QueryNodeData
  | EndpointNodeData;
