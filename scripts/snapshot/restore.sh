#!/usr/bin/env bash
# Reproduce the PINNED index locally from its Release asset + a deterministic (no-crawl) rebuild.
# After this, dist/ matches exactly what was pinned — even if every worktree was deleted.
# Usage: scripts/snapshot/restore.sh   (reads dist-snapshot.lock.json; needs gh + GOOGLE_API_KEY for embed)
set -euo pipefail
REPO="${OASIS_REPO:-Syntalic/OASIS}"
LOCK="dist-snapshot.lock.json"
[ -f "$LOCK" ] || { echo "ERROR: no $LOCK — nothing pinned yet (run publish.sh after a build)" >&2; exit 1; }
TAG="$(node -e "process.stdout.write(require('./$LOCK').release_tag)")"
ASSET="$(node -e "process.stdout.write(require('./$LOCK').asset)")"
WANT="$(node -e "process.stdout.write(require('./$LOCK').sha256)")"
echo "restoring pinned snapshot $TAG ..."
pnpm run build:ts                                            # the tool (dist/cli.js)
mkdir -p dist
gh release download "$TAG" --repo "$REPO" -p "$ASSET" -O dist/index.snapshot.json.gz --clobber
GOT="$(shasum -a 256 dist/index.snapshot.json.gz | awk '{print $1}')"
[ "$GOT" = "$WANT" ] || { echo "ERROR: sha256 mismatch (want $WANT got $GOT)" >&2; exit 1; }
gunzip -kf dist/index.snapshot.json.gz
node dist/cli.js ingest --snapshot dist/index.snapshot.json  # re-gate -> dist/index.json (deterministic)
pnpm run enrich                                              # re-bind (deterministic)
pnpm run embed                                               # lance vectors (gemini; deterministic given model)
echo "Restored dist/ from $TAG — matches the pinned/deployed index."
