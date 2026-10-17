#!/usr/bin/env bash
# Fetch the outcome of the `visual-regressions` job for the last N runs of the
# `frontend` workflow and write a TSV:
#   runId  event  headBranch  headSha  vrConclusion  vrStartedAt  vrCompletedAt
# Uses the GitHub CLI (must run inside `nix develop --command ...`).
# Read-only: does not count against the experiment CI budget.
set -euo pipefail

WORKFLOW=${WORKFLOW:-frontend.yml}
LIMIT=${LIMIT:-100}
OUT=${OUT:-.vrt-research/vrt-job-history.tsv}
PARALLEL=${PARALLEL:-4}

RUNS_JSON=$(mktemp)
trap 'rm -f "$RUNS_JSON"' EXIT

gh run list --workflow "$WORKFLOW" --limit "$LIMIT" \
  --json databaseId,event,headBranch,headSha,status >"$RUNS_JSON"

# One API call per run, 4 at a time (well inside the 5000 req/h limit).
fetch_one() {
  id=$1
  row=$(gh run view "$id" --json event,headBranch,headSha,status,jobs --jq '
    select(.status == "completed") |
    [.event, .headBranch, .headSha[0:8],
     (.jobs[] | select(.name=="visual-regressions")
      | [(.conclusion // "none"), (.startedAt // "-"), (.completedAt // "-")])]
    | [.[0], .[1], .[2], .[3][0], .[3][1], .[3][2]] | @tsv')
  [ -n "$row" ] && printf '%s\t%s\n' "$id" "$row"
  return 0
}
export -f fetch_one

{
  printf 'runId\tevent\theadBranch\theadSha\tvrConclusion\tvrStartedAt\tvrCompletedAt\n'
  node -e '
    const runs = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    for (const r of runs.filter((r) => r.status === "completed")) process.stdout.write(r.databaseId + "\n");
  ' "$RUNS_JSON" |
    xargs -P "$PARALLEL" -I{} bash -c 'fetch_one "$@"' _ {}
} >"$OUT"

echo "wrote $OUT ($(wc -l <"$OUT") lines)"
