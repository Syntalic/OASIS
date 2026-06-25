#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runIngest } from "./ingest/discover.js";
import { curatedCapabilitiesForSearch } from "./search/curated-search.js";
import { endpointId } from "./core/id.js";
import { defaultLanceDir, buildLanceIndex } from "./embed/lance-index.js";
import {
  DEFAULT_KEYWORD_WEIGHT,
  DEFAULT_VECTOR_WEIGHT,
  searchHybridWithFallback,
} from "./search/search-hybrid.js";
import { searchIndex } from "./search/search.js";
import { relatedOptions, type RelatedOption } from "./search/related.js";
import type { CapabilityIntent, EndpointRecord, IndexBundle } from "./core/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");

async function loadBundle(distDir: string): Promise<IndexBundle> {
  const raw = await readFile(path.join(distDir, "index.json"), "utf8");
  return JSON.parse(raw) as IndexBundle;
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`Invalid ${flag}: "${value}" (expected a positive integer)`);
    process.exit(1);
  }
  return n;
}

function parseWeight(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid ${flag}: "${value}" (expected a non-negative number)`);
    process.exit(1);
  }
  return n;
}

function resolveIntent(
  intentId: string,
  bundle: IndexBundle,
): {
  intent: CapabilityIntent;
  endpoints: EndpointRecord[];
  related: RelatedOption[];
} | null {
  const intent = curatedCapabilitiesForSearch(bundle).find((c) => c.id === intentId);
  if (!intent) return null;

  const endpoints: EndpointRecord[] = [];
  for (const ref of intent.satisfies) {
    const id = endpointId(ref.origin, ref.method, ref.path);
    const ep = bundle.endpoints.find((e) => e.id === id);
    if (ep) endpoints.push(ep);
  }
  return { intent, endpoints, related: relatedOptions(intent, bundle) };
}

const program = new Command();

program
  .name("capindex")
  .description("Vendor-neutral index for x402 and MPP paid API endpoints")
  .version("0.1.0");

program
  .command("search <query>")
  .description("Search capabilities and endpoints")
  .option("-l, --limit <n>", "Max results", "10")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--hybrid", "Keyword + vector RRF fusion (requires embed)")
  .option("--json", "Output JSON")
  .action(async (query, opts) => {
    const bundle = await loadBundle(opts.dist);
    const limit = parsePositiveInt(opts.limit, "--limit");
    const hits = opts.hybrid
      ? await searchHybridWithFallback(
          query,
          bundle,
          defaultLanceDir(opts.dist),
          limit,
        )
      : searchIndex(
          query,
          bundle.endpoints,
          curatedCapabilitiesForSearch(bundle),
          limit,
        );

    if (opts.json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }

    if (hits.length === 0) {
      console.log("No matches.");
      return;
    }

    for (const hit of hits) {
      const price =
        hit.price_usd != null ? `$${hit.price_usd.toFixed(4)}` : "—";
      const rails = hit.payment_rails?.join(", ") ?? "";
      const id = hit.capability_id ?? hit.endpoint_id ?? "";
      console.log(
        `${hit.score.toFixed(2)}\t[${hit.kind}]\t${id}\t${hit.label}\t${price}\t${rails}`,
      );
      if (hit.origin) {
        console.log(`       ${hit.method} ${hit.origin}${hit.path}`);
      }
    }
  });

program
  .command("resolve")
  .description("Resolve an intent or endpoint ID")
  .option("--intent <id>", "Capability intent ID")
  .option("--endpoint <id>", "Endpoint SHA-256 ID")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);

    if (opts.intent) {
      const resolved = resolveIntent(opts.intent, bundle);
      if (!resolved) {
        console.error(`Intent not found: ${opts.intent}`);
        process.exitCode = 1;
        return;
      }
      const payload = {
        intent: resolved.intent,
        endpoints: resolved.endpoints,
        related: resolved.related,
      };
      console.log(opts.json ? JSON.stringify(payload, null, 2) : formatResolve(payload));
      return;
    }

    if (opts.endpoint) {
      const ep = bundle.endpoints.find((e) => e.id === opts.endpoint);
      if (!ep) {
        console.error(`Endpoint not found: ${opts.endpoint}`);
        process.exitCode = 1;
        return;
      }
      console.log(opts.json ? JSON.stringify(ep, null, 2) : formatEndpoint(ep));
      return;
    }

    console.error("Pass --intent <id> or --endpoint <id>");
    process.exitCode = 1;
  });

program
  .command("validate")
  .description("Validate dist/index.json against schemas")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { validateBundle } = await import("./ontology/validate.js");
    const issues = await validateBundle(bundle);
    if (issues.length > 0) {
      for (const issue of issues) console.error(issue);
      process.exitCode = 1;
      return;
    }
    console.log("index.json is valid");
  });

program
  .command("validate-source [file]")
  .description("Validate a contributor task-intent YAML (or all ontology/intents) against the taxonomy")
  .action(async (file?: string) => {
    const { validateSourceFile, validateAllSources } = await import("./ontology/validate-source.js");
    const results = file
      ? [{ file, result: await validateSourceFile(file) }]
      : await validateAllSources();
    let failed = 0;
    for (const { file: f, result } of results) {
      for (const e of result.errors) {
        console.error(`✗ ${f}: ${e}`);
        failed += 1;
      }
      for (const w of result.warnings) console.error(`⚠ ${f}: ${w}`);
    }
    if (failed > 0) {
      console.error(`\n${failed} validation error(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`${results.length} source intent(s) valid`);
  });

program
  .command("taxonomy")
  .description("Dump the controlled vocabulary (capabilities + facet enums + entity vocab) to bind into")
  .option("--json", "Full JSON (default: summary)")
  .action(async (opts) => {
    const { getTaxonomy } = await import("./ontology/taxonomy.js");
    const tax = await getTaxonomy();
    if (opts.json) {
      console.log(JSON.stringify(tax, null, 2));
      return;
    }
    console.log(`${tax.capabilities.length} capabilities, ${tax.entities.length} entities`);
    console.log(`facets.domain: ${tax.facets.domain.join(", ")}`);
    console.log(`facets.action: ${tax.facets.action.join(", ")}`);
    console.log(`facets.modality: ${tax.facets.modality.join(", ")}`);
    console.log(`facets.freshness: ${tax.facets.freshness.join(", ")}`);
  });

program
  .command("validate-binding [file]")
  .description("Validate authored endpoint→capability binding(s) (ontology/bindings) against the taxonomy")
  .option("-d, --dist <dir>", "Dist dir for endpoint-match warnings", path.join(PACKAGE_ROOT, "dist"))
  .action(async (file: string | undefined, opts) => {
    const { validateBindingFile, validateAllBindings } = await import("./bind/binding.js");
    let endpoints;
    try {
      endpoints = (await loadBundle(opts.dist)).endpoints;
    } catch {
      /* index optional — capability/schema checks still run */
    }
    const results = file
      ? [{ file, result: await validateBindingFile(file, endpoints) }]
      : await validateAllBindings(undefined, endpoints);
    let failed = 0;
    for (const { file: f, result } of results) {
      for (const e of result.errors) {
        console.error(`✗ ${f}: ${e}`);
        failed += 1;
      }
      for (const w of result.warnings) console.error(`⚠ ${f}: ${w}`);
    }
    if (failed > 0) {
      console.error(`\n${failed} binding error(s)`);
      process.exitCode = 1;
      return;
    }
    console.log(`${results.length} binding file(s) valid`);
  });

program
  .command("ingest")
  .description("Federated discovery + enrichment + gate → dist/index.json (pre-binding)")
  .option("-o, --output <dir>", "Output directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--snapshot <file>", "Rebuild from a saved merged-record snapshot (skip the network crawl) — re-gates + writes the bundle")
  .option("--bazaar-max-pages <n>", "Limit Bazaar pages (debug)")
  .option("--enrich-limit <n>", "Limit origins enriched (debug)")
  .option("--concurrency <n>", "Enrichment concurrency", "16")
  .action(async (opts) => {
    const bundle = await runIngest({
      outputDir: opts.output,
      builtAt: new Date().toISOString(),
      snapshotPath: opts.snapshot,
      bazaarMaxPages: opts.bazaarMaxPages ? Number(opts.bazaarMaxPages) : undefined,
      enrichLimit: opts.enrichLimit ? Number(opts.enrichLimit) : undefined,
      enrichConcurrency: Number(opts.concurrency),
    });
    console.log(`ingest → ${opts.output}/index.json: ${bundle.stats.endpoints} endpoints, ${bundle.stats.origins} origins`);
  });

program
  .command("embed")
  .description("Build LanceDB vector index from capabilities and providers")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("-o, --output <dir>", "Lance output directory")
  .option(
    "--scope <scope>",
    "Embed scope: all, capabilities, or curated (ontology YAML subset)",
    "curated",
  )
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const outDir = opts.output ?? defaultLanceDir(opts.dist);
    const scope = opts.scope as "all" | "capabilities" | "curated";
    const result = await buildLanceIndex(bundle, outDir, scope);
    console.log(`Lance index built: ${result.records} vectors (scope=${result.scope})`);
    console.log(`  table: ${result.table}`);
    console.log(`  path:  ${result.path}`);
  });

program
  .command("eval")
  .description("Run discovery benchmark against golden queries")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .option("--misses", "Show queries that missed discover@3")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runDiscoveryBenchmark, formatReportTable } = await import(
      "./eval/discovery-benchmark.js"
    );
    const reports = await runDiscoveryBenchmark(bundle);
    if (opts.json) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }
    console.log("Discovery benchmark (golden queries)\n");
    console.log(formatReportTable(reports));
    if (opts.misses) {
      const full = reports.find((r) => r.mode === "full");
      if (full) {
        const misses = full.results.filter(
          (r) => r.discover_rank == null || r.discover_rank > 3,
        );
        if (misses.length) {
          console.log("\nMisses (full index, discover@3):");
          for (const m of misses) {
            console.log(`  - ${m.id}: "${m.query}" → top: ${m.top_label}`);
          }
        } else {
          console.log("\nNo misses — all queries hit discover@3.");
        }
      }
    }
    const { METRICS_LEGEND } = await import("./eval/metrics.js");
    console.log(`\nLegend:\n${METRICS_LEGEND}\n`);
  });

program
  .command("eval:resolve")
  .description("Check materialized curated intents link to indexed endpoints")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .option("--misses", "Show unresolved intents only")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runResolveBenchmark, formatResolveReport } = await import(
      "./eval/resolve-benchmark.js"
    );
    const report = await runResolveBenchmark(bundle);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatResolveReport(report));
    }

    if (opts.misses) {
      const misses = report.results.filter((r) => !r.resolved);
      if (misses.length) {
        console.log("\nUnresolved (no materialized candidates):");
        for (const m of misses) {
          console.log(`  - ${m.intent_id}: ${m.label}`);
        }
      } else {
        console.log("\nNo misses — all curated intents resolve.");
      }
    }

    if (report.missing > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("eval:multi")
  .description("Multi-label / hard-negative / related discovery benchmark")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { loadMultiLabelQueries, runMultiLabelBenchmark, formatMultiLabelReport } =
      await import("./eval/multi-label-benchmark.js");
    const queries = await loadMultiLabelQueries();
    const report = runMultiLabelBenchmark(bundle, queries);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatMultiLabelReport(report));
    }
  });

program
  .command("eval:heldout")
  .description("Held-out generalization benchmark (queries phrased away from labels)")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { loadHeldoutQueries, runHeldoutBenchmark, formatHeldoutReport } =
      await import("./eval/heldout-benchmark.js");
    const report = runHeldoutBenchmark(bundle, await loadHeldoutQueries());
    console.log(
      opts.json ? JSON.stringify(report, null, 2) : formatHeldoutReport(report),
    );
  });

program
  .command("eval:compare")
  .description(
    "Compare discovery methods on messy NL queries (internal slices + external APIs)",
  )
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .option("--offline", "Skip live external APIs (cdp-bazaar, mpp-catalog-live)")
  .option(
    "--methods <list>",
    "Comma-separated methods (default: all)",
  )
  .option("--misses", "Show queries that missed discover@3 per method")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runCompareBenchmark, formatCompareTable, VALID_METHODS } =
      await import("./eval/compare-benchmark.js");
    type BenchmarkMode = import("./eval/discovery-benchmark.js").BenchmarkMode;
    const methods: BenchmarkMode[] | undefined = opts.methods
      ? (opts.methods as string)
          .split(",")
          .map((m: string) => m.trim() as BenchmarkMode)
      : undefined;
    if (methods) {
      const unknown = methods.filter((m) => !VALID_METHODS.has(m));
      if (unknown.length) {
        console.error(
          `Unknown --methods: ${unknown.join(", ")}. Valid: ${[
            ...VALID_METHODS,
          ].join(", ")}`,
        );
        process.exit(1);
      }
    }
    const reports = await runCompareBenchmark(bundle, {
      distDir: opts.dist,
      offline: Boolean(opts.offline),
      methods,
    });

    if (opts.json) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }

    console.log(formatCompareTable(reports));

    if (opts.misses) {
      for (const r of reports) {
        const misses = r.results.filter(
          (q) => q.discover_rank == null || q.discover_rank > 3,
        );
        if (misses.length) {
          console.log(`\nMisses — ${r.mode} (${misses.length}):`);
          for (const m of misses) {
            console.log(`  • ${m.id}: "${m.query}" → top: ${m.top_label}`);
          }
        }
      }
    }

    const { METRICS_LEGEND } = await import("./eval/metrics.js");
    console.log(`\nLegend:\n${METRICS_LEGEND}\n`);
  });

program
  .command("eval:methods")
  .description(
    "Discovery-method comparison: oasis vs spec-embedding vs catalog (+ optional live registry)",
  )
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .option("--out <file>", "Write JSON report to file (E3 baseline capture)")
  .option("--live", "Also hit a live external registry API (cross-corpus floor, not apples-to-apples)")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runMethodBenchmark, formatMethodTable } = await import(
      "./eval/method-benchmark.js"
    );
    const reports = await runMethodBenchmark(bundle, {
      distDir: opts.dist,
      live: Boolean(opts.live),
    });
    if (opts.out) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(opts.out, `${JSON.stringify(reports, null, 2)}\n`, "utf8");
      console.log(`wrote ${opts.out}`);
    }
    if (opts.json) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }
    if (!opts.out) {
      console.log(formatMethodTable(reports));
    }
  });

program
  .command("eval:hybrid")
  .description("Compare keyword vs hybrid search on messy natural-language queries")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .option("--verify", "Only verify messy-queries.json refs against index")
  .option(
    "--keyword-weight <n>",
    "RRF weight for keyword ranks",
    String(DEFAULT_KEYWORD_WEIGHT),
  )
  .option(
    "--vector-weight <n>",
    "RRF weight for vector ranks",
    String(DEFAULT_VECTOR_WEIGHT),
  )
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const {
      runHybridMvp,
      formatHybridComparison,
      verifyMessyQueries,
    } = await import("./eval/hybrid-mvp.js");

    if (opts.verify) {
      const issues = await verifyMessyQueries(bundle);
      if (issues.length) {
        for (const issue of issues) console.error(issue);
        process.exitCode = 1;
        return;
      }
      console.log("messy-queries.json: all refs valid");
      return;
    }

    const fusion = {
      keywordWeight: parseWeight(opts.keywordWeight, "--keyword-weight"),
      vectorWeight: parseWeight(opts.vectorWeight, "--vector-weight"),
    };
    const comparison = await runHybridMvp(bundle, opts.dist, fusion);
    if (opts.json) {
      console.log(JSON.stringify({ fusion, ...comparison }, null, 2));
      return;
    }
    console.log(formatHybridComparison(comparison, fusion));
  });

program
  .command("stats")
  .description("Show index statistics")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    console.log(JSON.stringify(bundle.stats, null, 2));
    console.log("sources:", bundle.sources);
  });

function formatEndpoint(ep: EndpointRecord): string {
  const rails = ep.payment.rails.map((r) => r.protocol).join(", ");
  const price = ep.payment.price_usd != null ? `$${ep.payment.price_usd}` : "—";
  return [
    `${ep.summary}`,
    `  ${ep.method} ${ep.origin}${ep.path}`,
    `  id: ${ep.id}`,
    `  price: ${price}  rails: ${rails}`,
    `  provider: ${ep.provider_fqn ?? "—"}`,
    `  capabilities: ${(ep.capabilities ?? []).join(", ") || "—"}`,
    `  openapi: ${ep.openapi_url ?? "—"}`,
  ].join("\n");
}

function formatResolve(payload: {
  intent: CapabilityIntent;
  endpoints: EndpointRecord[];
  related: RelatedOption[];
}): string {
  const lines = [
    `Intent: ${payload.intent.id} — ${payload.intent.label}`,
    payload.intent.description ?? "",
    "",
    "Endpoints:",
  ];
  for (const ep of payload.endpoints) {
    lines.push(`  • ${ep.method} ${ep.origin}${ep.path} (${ep.payment.price_usd ?? "?"} USD)`);
  }
  if (payload.endpoints.length === 0) {
    lines.push("  (no indexed endpoints matched — check ontology satisfies refs)");
  }
  if (payload.related.length) {
    lines.push("", "Alternatives & related options:");
    for (const r of payload.related) {
      const ep = r.top_endpoint
        ? `  → ${r.top_endpoint.method} ${r.top_endpoint.origin}${r.top_endpoint.path}`
        : "";
      lines.push(`  • [${r.relation_label}] ${r.intent_id} — ${r.label}${ep}`);
    }
  }
  return lines.filter(Boolean).join("\n");
}

program
  .command("eval:bridges")
  .description("E1 bridge validation on built entity-index (v1 identity lateral gates)")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { loadEntityIndex } = await import("./entity/entity-index.js");
    const { loadBridgeScenarios, runBridgeValidation } = await import(
      "./eval/bridge-validation.js"
    );
    const { curatedCapabilitiesForSearch } = await import("./search/curated-search.js");
    const entityIndex = await loadEntityIndex(opts.dist);
    const scenarios = await loadBridgeScenarios();
    const capabilities = curatedCapabilitiesForSearch(bundle);
    const report = runBridgeValidation(capabilities, entityIndex, scenarios);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`E1 bridge validation: ${report.passed}/${report.passed + report.failed} passed`);
      for (const r of report.results) {
        console.log(`  ${r.passed ? "✓" : "✗"} ${r.id}${r.missing.length ? ` missing: ${r.missing.join(", ")}` : ""}`);
      }
    }
    if (report.failed > 0) process.exit(1);
  });

program
  .command("eval:usefulness")
  .description("E2 usefulness eval — investigative leads from real suggestFollowUps path")
  .option("-d, --dist <dir>", "Dist directory", path.join(PACKAGE_ROOT, "dist"))
  .option("--json", "Output JSON report")
  .action(async (opts) => {
    const bundle = await loadBundle(opts.dist);
    const { runUsefulnessEval } = await import("./eval/usefulness-eval.js");
    const report = await runUsefulnessEval(bundle, opts.dist);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("E2 usefulness eval:");
      console.log(`  callable_precision: ${report.callable_precision.toFixed(3)}`);
      console.log(`  lateral_relevance_precision: ${report.lateral_relevance_precision.toFixed(3)}`);
      console.log(`  identity_recall: ${report.identity_recall.toFixed(3)}`);
      console.log(`  good_recall@6: ${report.good_recall_at_6.toFixed(3)}`);
      console.log(`  bad_rate@8: ${report.bad_rate_at_8.toFixed(3)}`);
      console.log(`  domain_diversity: ${report.domain_diversity.toFixed(2)}`);
      console.log(
        `  baseline catalog_aware good_recall@6: ${report.baseline_catalog_aware.good_recall_at_6.toFixed(3)}`,
      );
      console.log(
        `  baseline catalog_aware lateral_precision: ${report.baseline_catalog_aware.lateral_relevance_precision.toFixed(3)}`,
      );
      console.log(`  beats_baseline: ${report.beats_baseline}`);
      console.log(`  passed: ${report.passed}`);
    }
    if (!report.passed) process.exit(1);
  });

program.parse();