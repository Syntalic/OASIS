export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface PaymentRail {
  protocol: "x402" | "mpp";
  version?: string;
  networks?: string[];
}

export interface PaymentInfo {
  price_usd?: number;
  paid: boolean;
  rails: PaymentRail[];
}

export interface EndpointRecord {
  id: string;
  origin: string;
  method: HttpMethod;
  path: string;
  operation_id?: string;
  summary: string;
  description?: string;
  tags?: string[];
  provider_fqn?: string;
  provider_title?: string;
  category?: string;
  capabilities?: string[];
  inputs?: string[];
  payment: PaymentInfo;
  guidance_available?: boolean;
  openapi_url?: string;
  search_text: string;
  built_at: string;
}

export interface SatisfiesRef {
  origin: string;
  method: string;
  path: string;
  confidence?: "primary" | "secondary" | "fallback";
  notes?: string;
}

export interface CapabilityIntent {
  id: string;
  label: string;
  description?: string;
  aliases?: string[];
  schema_org?: string[];
  related?: string[];
  satisfies: SatisfiesRef[];
}

export interface PaySkillsProvider {
  fqn: string;
  name: string;
  title: string;
  description: string;
  use_case: string;
  category: string;
  service_url: string;
  openapi_path: string;
  capabilities?: string[];
}

export interface IndexBundle {
  index_version: string;
  spec_version: string;
  built_at: string;
  sources: Array<{
    name: string;
    path: string;
    providers?: number;
    endpoints?: number;
  }>;
  stats: {
    providers: number;
    endpoints: number;
    capabilities: number;
    origins: number;
  };
  endpoints: EndpointRecord[];
  capabilities: CapabilityIntent[];
}

export interface SearchHit {
  kind: "capability" | "endpoint";
  score: number;
  capability_id?: string;
  endpoint_id?: string;
  label: string;
  summary: string;
  origin?: string;
  method?: string;
  path?: string;
  price_usd?: number;
  payment_rails?: string[];
  provider_fqn?: string;
}