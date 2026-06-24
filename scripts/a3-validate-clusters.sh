#!/usr/bin/env bash
# A3 parallel cluster validation — one oasis_validate-source pass per blueprint cluster.
# Background jobs are launched in THIS shell (not a process-substitution subshell) so wait works.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?usage: a3-validate-clusters.sh <scratch-dir>}"
mkdir -p "$OUT"
cd "$ROOT"
CLI="node dist/cli.js"

pids=()
cluster_ids=()

run_cluster() {
  local id="$1"
  shift
  local log="$OUT/cluster-${id}.log"
  cluster_ids+=("$id")
  (
    echo "cluster=$id"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "pid=$$"
    echo "files=$*"
    local ok=0 fail=0
    for f in "$@"; do
      echo "--- validate $f ---"
      if $CLI validate-source "$f"; then ok=$((ok+1)); else fail=$((fail+1)); fi
    done
    echo "summary valid=$ok failed=$fail"
    echo "ended_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    exit "$fail"
  ) >"$log" 2>&1 &
  pids+=("$!")
  echo "launched cluster=$id pid=$! log=$log"
}

run_cluster maps-travel-realestate \
  ontology/intents/maps.geocode.yaml ontology/intents/maps.places.yaml \
  ontology/intents/travel.place-reviews.yaml ontology/intents/realestate.property-lookup.yaml

run_cluster shop-marketing-analyst \
  ontology/intents/shop.compare-price.yaml ontology/intents/shop.find-deals.yaml \
  ontology/intents/shop.price-drop-alert.yaml ontology/intents/shop.track-price-history.yaml \
  ontology/intents/marketing.competitive-landscape.yaml ontology/intents/analyst.inflation-tracker.yaml

run_cluster finance-crypto-compute \
  ontology/intents/finance.crypto-spot-price.yaml ontology/intents/finance.stock-quote.yaml \
  ontology/intents/finance.onchain-analytics.yaml ontology/intents/finance.token-balance.yaml \
  ontology/intents/finance.prediction-markets.yaml ontology/intents/finance.trading-signals.yaml \
  ontology/intents/finance.economic-data.yaml ontology/intents/compute.blockchain-rpc.yaml

run_cluster data \
  ontology/intents/data.weather-forecast.yaml ontology/intents/data.gov-civic.yaml \
  ontology/intents/data.person-search.yaml ontology/intents/data.job-search.yaml \
  ontology/intents/data.whois-lookup.yaml ontology/intents/data.company-enrich.yaml \
  ontology/intents/data.web-scrape.yaml ontology/intents/data.ip-lookup.yaml

run_cluster ai-search-web \
  ontology/intents/ai.web-research.yaml ontology/intents/ai.document-extract.yaml \
  ontology/intents/search.web.yaml ontology/intents/web.markdown-extract.yaml \
  ontology/intents/web.screenshot.yaml

run_cluster comms-media-social \
  ontology/intents/media.social-data.yaml ontology/intents/social.influencer-search.yaml \
  ontology/intents/comms.send-email.yaml ontology/intents/comms.send-sms.yaml

run_cluster agent-devtools-storage-cloud \
  ontology/intents/agent.memory.yaml ontology/intents/devtools.captcha-solve.yaml \
  ontology/intents/storage.hosting.yaml ontology/intents/cloud.domain-manage.yaml

echo "launched_pids=${pids[*]}" | tee "$OUT/launch.meta"
fail=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then fail=$((fail+1)); fi
done
echo "clusters_failed=$fail" | tee -a "$OUT/launch.meta"
echo "cluster_ids=${cluster_ids[*]}" | tee -a "$OUT/launch.meta"
exit "$fail"