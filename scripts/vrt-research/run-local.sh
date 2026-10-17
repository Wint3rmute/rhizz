#!/usr/bin/env bash
# Run the VRT suite N times sequentially and keep per-run artifacts.
#
# usage: run-local.sh <label> <n> [workers] [-- extra playwright args]
#   <label>    subdirectory under .vrt-research/runs/local/
#   <n>        number of whole-suite runs (never below 10 for a real baseline)
#   [workers]  Playwright worker count (default: config default)
#
# Each run gets a fresh dir with: meta.json (exit code, duration, SHA, workers),
# report.json (Playwright JSON reporter -> machine-readable failures+pixels),
# test-results/ and vrt-report/ (actual/expected/diff images per failure).
set -euo pipefail

LABEL=$1
N=$2
WORKERS=${3:-}
if [ "${WORKERS:-}" = "--" ]; then WORKERS=""; fi
shift 3 2>/dev/null || shift $#
[ "${1:-}" = "--" ] && shift
EXTRA_ARGS=("$@")

BASE=".vrt-research/runs/local/$LABEL"
SHA=$(git rev-parse --short HEAD)
mkdir -p "$BASE"

# Single-instance guard: two loops writing the same label dir steal each
# other's test-results and contaminate the measurement (they did exactly that
# once during this research).
LOCK="$BASE/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another $LABEL run is active (lock $LOCK)" >&2
  exit 1
fi
trap 'rmdir "$LOCK"' EXIT

WORKERS_ARG=""
[ -n "$WORKERS" ] && WORKERS_ARG="--workers=$WORKERS"

echo "label=$LABEL runs=$N workers=${WORKERS:-default} extra=${EXTRA_ARGS[*]:-} sha=$SHA"
for i in $(seq 1 "$N"); do
  dir="$BASE/run-$i"
  mkdir -p "$dir"
  rm -rf web/test-results web/vrt-report
  start=$(date +%s)
  set +e
  (
    cd web
    PLAYWRIGHT_JSON_OUTPUT_NAME="$PWD/../$dir/report.json" \
      npm run test:vrt -- --reporter=json $WORKERS_ARG "${EXTRA_ARGS[@]}" \
      >"$PWD/../$dir/stdout.log" 2>&1
  )
  code=$?
  set -e
  end=$(date +%s)
  cp -r web/test-results "$dir/" 2>/dev/null || true
  cp -r web/vrt-report "$dir/" 2>/dev/null || true
  nix develop --command node -e '
    const fs = require("fs");
    const [dir, code, dur, sha, workers] = process.argv.slice(1);
    fs.writeFileSync(
      dir + "/meta.json",
      JSON.stringify({ exitCode: +code, durationSec: +dur, sha, workers }, null, 2),
    );
  ' "$dir" "$code" "$((end - start))" "$SHA" "${WORKERS:-default}"
  echo "run-$i: exit=$code dur=$((end - start))s"
done
echo "wrote $BASE"
