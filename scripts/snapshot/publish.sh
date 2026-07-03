#!/usr/bin/env bash
# Pin the CURRENT built index as a versioned GitHub Release asset, and update the committed
# lockfile (dist-snapshot.lock.json) that points the code at it. Run after an authoritative build.
# The Release is the durable store; the lockfile is the tiny in-git pin (survives worktree deletion).
# Requires: gh (authed), dist/index.json present, GOOGLE_API_KEY used earlier for the build.
set -euo pipefail
REPO="${OASIS_REPO:-Syntalic/OASIS}"
SRC="dist/index.json"
[ -f "$SRC" ] || { echo "ERROR: $SRC missing — run 'pnpm build' first" >&2; exit 1; }
SHA="$(git rev-parse --short HEAD)"; FULL="$(git rev-parse HEAD)"; DATE="$(date +%Y%m%d)"
TAG="oasis-index-${DATE}-${SHA}"
gzip -kf "$SRC"                                   # -> dist/index.json.gz (~5MB)
HASH="$(shasum -a 256 "${SRC}.gz" | awk '{print $1}')"
# Pin the endpoint I/O schema store too (spec >= 0.3.0) so restore.sh reproduces real schemas
# instead of dangling refs. Fail-soft for a pre-schema build with no dist/schemas.json.
SCHEMAS_LOCK=""
if [ -f dist/schemas.json ]; then
  gzip -kf dist/schemas.json                      # -> dist/schemas.json.gz
  SHASH="$(shasum -a 256 dist/schemas.json.gz | awk '{print $1}')"
  SCHEMAS_LOCK=$'\n  "schemas_asset": "schemas.json.gz",\n  "schemas_sha256": "'"${SHASH}"'",'
fi
echo "publishing $TAG ($(du -h "${SRC}.gz" | awk '{print $1}'))..."
gh release create "$TAG" "${SRC}.gz" --repo "$REPO" \
  --title "OASIS index snapshot ${DATE} (${SHA})" \
  --notes "Frozen index/crawl built from ${FULL}. Restore: scripts/snapshot/restore.sh (reads dist-snapshot.lock.json)."
[ -f dist/schemas.json.gz ] && gh release upload "$TAG" dist/schemas.json.gz --repo "$REPO"
cat > dist-snapshot.lock.json <<JSON
{
  "release_tag": "${TAG}",
  "asset": "index.json.gz",${SCHEMAS_LOCK}
  "sha256": "${HASH}",
  "built_from_commit": "${FULL}",
  "pinned_at": "${DATE}"
}
JSON
echo "Pinned ${TAG}. COMMIT dist-snapshot.lock.json so the index is reproducible from this commit."
