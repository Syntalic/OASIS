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
echo "publishing $TAG ($(du -h "${SRC}.gz" | awk '{print $1}'))..."
gh release create "$TAG" "${SRC}.gz" --repo "$REPO" \
  --title "OASIS index snapshot ${DATE} (${SHA})" \
  --notes "Frozen index/crawl built from ${FULL}. Restore: scripts/snapshot/restore.sh (reads dist-snapshot.lock.json)."
cat > dist-snapshot.lock.json <<JSON
{
  "release_tag": "${TAG}",
  "asset": "index.json.gz",
  "sha256": "${HASH}",
  "built_from_commit": "${FULL}",
  "pinned_at": "${DATE}"
}
JSON
echo "Pinned ${TAG}. COMMIT dist-snapshot.lock.json so the index is reproducible from this commit."
