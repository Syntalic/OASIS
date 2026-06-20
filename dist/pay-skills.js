import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { parseOpenApi } from "./openapi-parser.js";
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    return parseYaml(match[1]) ?? {};
}
async function findPayMdFiles(root) {
    const results = [];
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            }
            else if (entry.name === "PAY.md") {
                results.push(full);
            }
        }
    }
    await walk(root);
    return results;
}
function providerFromPayMd(payMdPath, providersRoot, frontmatter) {
    const relDir = path.dirname(path.relative(providersRoot, payMdPath));
    const fqn = relDir.split(path.sep).join("/");
    const name = String(frontmatter.name ?? path.basename(relDir));
    const title = String(frontmatter.title ?? name);
    const description = String(frontmatter.description ?? "");
    const use_case = String(frontmatter.use_case ?? "");
    const category = String(frontmatter.category ?? "other");
    const service_url = String(frontmatter.service_url ?? "");
    const openapi = frontmatter.openapi;
    if (!service_url || !openapi?.path)
        return null;
    return {
        fqn,
        name,
        title,
        description,
        use_case,
        category,
        service_url: service_url.replace(/\/$/, ""),
        openapi_path: String(openapi.path),
        capabilities: frontmatter.capabilities,
    };
}
export async function ingestPaySkills(paySkillsDir, builtAt) {
    const providersRoot = path.join(paySkillsDir, "providers");
    const payMdFiles = await findPayMdFiles(providersRoot);
    const providers = [];
    const endpoints = [];
    for (const payMdPath of payMdFiles) {
        const raw = await readFile(payMdPath, "utf8");
        const frontmatter = parseFrontmatter(raw);
        const provider = providerFromPayMd(payMdPath, providersRoot, frontmatter);
        if (!provider)
            continue;
        const openapiFull = path.join(path.dirname(payMdPath), provider.openapi_path);
        try {
            await stat(openapiFull);
        }
        catch {
            continue;
        }
        const openapiRaw = await readFile(openapiFull, "utf8");
        const doc = JSON.parse(openapiRaw);
        providers.push(provider);
        endpoints.push(...parseOpenApi(doc, {
            origin: provider.service_url,
            provider,
            builtAt,
            capabilityIds: provider.capabilities,
        }));
    }
    return { providers, endpoints };
}
//# sourceMappingURL=pay-skills.js.map