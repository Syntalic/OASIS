import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { canonicalOrigin } from "./origin-aliases.js";
import { parseOpenApi } from "./openapi-parser.js";
import type { EndpointRecord, PaySkillsProvider } from "./types.js";

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return (parseYaml(match[1]) as Record<string, unknown>) ?? {};
}

async function findPayMdFiles(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name === "PAY.md") {
        results.push(full);
      }
    }
  }

  await walk(root);
  return results;
}

function providerFromPayMd(
  payMdPath: string,
  providersRoot: string,
  frontmatter: Record<string, unknown>,
): PaySkillsProvider | null {
  const relDir = path.dirname(path.relative(providersRoot, payMdPath));
  const fqn = relDir.split(path.sep).join("/");
  const name = String(frontmatter.name ?? path.basename(relDir));
  const title = String(frontmatter.title ?? name);
  const description = String(frontmatter.description ?? "");
  const use_case = String(frontmatter.use_case ?? "");
  const category = String(frontmatter.category ?? "other");
  const service_url = String(frontmatter.service_url ?? "");
  const openapi = frontmatter.openapi as Record<string, unknown> | undefined;

  if (!service_url || !openapi?.path) return null;

  return {
    fqn,
    name,
    title,
    description,
    use_case,
    category,
    service_url: canonicalOrigin(service_url.replace(/\/$/, "")),
    openapi_path: String(openapi.path),
    capabilities: frontmatter.capabilities as string[] | undefined,
  };
}

export async function ingestPaySkills(
  paySkillsDir: string,
  builtAt: string,
): Promise<{ providers: PaySkillsProvider[]; endpoints: EndpointRecord[] }> {
  const providersRoot = path.join(paySkillsDir, "providers");
  const payMdFiles = await findPayMdFiles(providersRoot);
  const providers: PaySkillsProvider[] = [];
  const endpoints: EndpointRecord[] = [];

  for (const payMdPath of payMdFiles) {
    const raw = await readFile(payMdPath, "utf8");
    const frontmatter = parseFrontmatter(raw);
    const provider = providerFromPayMd(payMdPath, providersRoot, frontmatter);
    if (!provider) continue;

    const openapiFull = path.join(path.dirname(payMdPath), provider.openapi_path);
    try {
      await stat(openapiFull);
    } catch {
      continue;
    }

    const openapiRaw = await readFile(openapiFull, "utf8");
    const doc = JSON.parse(openapiRaw) as Record<string, unknown>;
    providers.push(provider);
    endpoints.push(
      ...parseOpenApi(doc, {
        origin: provider.service_url,
        provider,
        builtAt,
        capabilityIds: provider.capabilities,
      }),
    );
  }

  return { providers, endpoints };
}