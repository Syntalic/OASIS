# Reproducible index snapshots

The OASIS index (`dist/index.json`) is **build output**: gitignored, and produced by a **non-deterministic
network crawl** (`pnpm build` → ingest crawls live registries → enrich binds). Two builds of the same
commit produce ~50% different indexes. The deploy ships a **pre-built `dist/`** (`mcp/deploy/Dockerfile`
`COPY dist ./dist`), so the deployed index was whatever happened to be on the build machine — and once
that worktree is gone, **the exact deployed index is unrecoverable**. That's a reproducibility hole: a
redeploy reshuffles the catalog, and eval can't match production.

## The fix: pin a snapshot, deploy from it, eval against it

1. **Pin** an authoritative build as a versioned **GitHub Release asset** (`index.json.gz`), tagged to the
   commit, and record it in the committed **`dist-snapshot.lock.json`** (the tiny in-git pointer).
2. **Restore** anywhere — even with every worktree deleted — by `git checkout <commit>` (reads the lock) +
   `scripts/snapshot/restore.sh` (downloads the asset + a **deterministic, no-crawl** rebuild via
   `ingest --snapshot`). dist/ stays derivable; the lockfile + Release are the source of truth.
3. **Deploy from the same snapshot**, so deployed-index ≡ eval-index ≡ pinned snapshot — they can't drift.

The crawl is non-deterministic, but **everything after the crawl is deterministic** (`ingest --snapshot`
re-gates, `enrich` binds, `embed` vectors). So pinning the *crawl/index* artifact makes the whole pipeline
reproducible. (Releases, not Git LFS: the snapshot is ~47 MB / ~5 MB gzipped — Release assets avoid LFS
quota and match the existing "consume the prebuilt index via Releases" convention.)

## Commands

```bash
# After an authoritative build (pnpm build), pin it:
scripts/snapshot/publish.sh          # creates Release oasis-index-<date>-<sha> + writes dist-snapshot.lock.json
git add dist-snapshot.lock.json && git commit -m "chore: pin index snapshot <tag>"

# Reproduce the pinned index anywhere (worktree-deletion-proof):
scripts/snapshot/restore.sh          # gh download + ingest --snapshot + enrich + embed  (needs GOOGLE_API_KEY)
```

## Deploy

Before `fly deploy`, materialize `dist/` from the pin so the image ships the **reproducible** index:

```bash
scripts/snapshot/restore.sh && (cd mcp/deploy && fly deploy ...)   # Dockerfile COPY dist now copies the pinned index
```

## Eval (dogfooding harness)

The dogfooding ruler must run against the **pinned** index so its numbers predict production. Run the local
MCP off the restored `dist/` (or a server pointed at it); control and treatment then share one index, so A/B
deltas are pure code effects. See `Dogfooding-OASIS/reports/oasis-implementation-plan.md`.
