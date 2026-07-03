/** View-layer types for the React Flow graph (distinct from the ontology data model). */

export type NodeKind = "domain" | "capability" | "entity" | "query" | "endpoint" | "workflow" | "workflowStep";

export type EdgeKind =
  | "membership" // capability → domain
  | "consumes" // entity → capability
  | "produces" // capability → entity
  | "match" // question → capability
  | "serves" // capability → endpoint
  | "recommends" // question → recommended workflow
  | "workflow"; // workflow root → step, or step(n) → step(n+1) in a chain

export type Mode = "explore" | "ask";

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
  recommends: { label: "recommends" },
  workflow: { label: "step" },
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

/** oasis_discover recommended_workflows shape (mirrors mcp/tools.mjs + spec/workflow.schema.json). */
export interface WorkflowEndpoint {
  method: string;
  url: string;
  price_usd?: number;
  rails?: string[];
  endpoint_id?: string;
}
export interface RecommendedWorkflowStep {
  n: number;
  intent_id: string;
  do: string;
  optional?: boolean;
  gate?: string;
  endpoint: WorkflowEndpoint | null;
}
export interface RecommendedWorkflow {
  id: string;
  goal: string;
  shape: "chain" | "fanout";
  match_score: number;
  source: string;
  total_price_usd: number;
  produces: string;
  steps: RecommendedWorkflowStep[];
}

export interface WorkflowNodeData extends CommonNodeData {
  kind: "workflow";
  workflow: RecommendedWorkflow;
  color: string;
}
export interface WorkflowStepNodeData extends CommonNodeData {
  kind: "workflowStep";
  workflowId: string;
  step: RecommendedWorkflowStep;
  label: string;
  color: string;
}

export type AnyNodeData =
  | DomainNodeData
  | CapabilityNodeData
  | EntityNodeData
  | QueryNodeData
  | EndpointNodeData
  | WorkflowNodeData
  | WorkflowStepNodeData;
