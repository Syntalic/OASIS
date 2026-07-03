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
# Endpoint I/O schemas (spec >= 0.3.0): fetch alongside so the snapshot rebuild carries them forward
# instead of leaving every schema ref dangling. Absent on pre-schema pins (fine — skipped).
SCHEMAS_ASSET="$(node -e "process.stdout.write(require('./$LOCK').schemas_asset || '')")"
if [ -n "$SCHEMAS_ASSET" ]; then
  gh release download "$TAG" --repo "$REPO" -p "$SCHEMAS_ASSET" -O dist/schemas.json.gz --clobber
  SWANT="$(node -e "process.stdout.write(require('./$LOCK').schemas_sha256 || '')")"
  SGOT="$(shasum -a 256 dist/schemas.json.gz | awk '{print $1}')"
  { [ -z "$SWANT" ] || [ "$SGOT" = "$SWANT" ]; } || { echo "ERROR: schemas.json sha256 mismatch (want $SWANT got $SGOT)" >&2; exit 1; }
  gunzip -kf dist/schemas.json.gz                            # -> dist/schemas.json (carried forward by ingest below)
fi
node dist/cli.js ingest --snapshot dist/index.snapshot.json  # re-gate -> dist/index.json (+ carries schemas.json)
pnpm run enrich                                              # re-bind (deterministic)
pnpm run embed                                               # lance vectors (gemini; deterministic given model)
echo "Restored dist/ from $TAG — matches the pinned/deployed index."
