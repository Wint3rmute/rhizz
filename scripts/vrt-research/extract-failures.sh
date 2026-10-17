#!/usr/bin/env bash
# Extract failing VRT test names + diff stats from historical CI run logs.
# Writes .vrt-research/vrt-failures.tsv:
#   runId  headSha  testName  errorType  pixels  ratio
# Read-only: uses the GitHub CLI (run inside `nix develop --command ...`).
set -euo pipefail

HIST=${HIST:-.vrt-research/vrt-job-history.tsv}
OUT=${OUT:-.vrt-research/vrt-failures.tsv}
LOGDIR=${LOGDIR:-.vrt-research/runs/ci}
mkdir -p "$LOGDIR"

{
  printf 'runId\theadSha\ttestName\terrorType\tpixels\tratio\n'
  # Failed VRT runs only (skip the header line).
  awk -F'\t' 'NR>1 && $5=="failure" {print $1"\t"$4}' "$HIST" |
    while IFS=$'\t' read -r id sha; do
      log="$LOGDIR/$id.log"
      if [ ! -f "$log" ]; then
        gh run view "$id" --log >"$log" 2>/dev/null || {
          echo "warn: could not fetch log for $id" >&2
          continue
        }
      fi
      node -e '
        const fs = require("fs");
        const [id, sha] = process.argv.slice(1);
        const log = fs.readFileSync(process.argv[3], "utf8")
          .replace(/\x1b\[[0-9;]*m/g, "");
        const lines = log.split("\n");

        // Strip the gh-log line prefix ("job  STEP  timestampZ  content").
        const content = lines.map((l) => l.replace(/^.*?UNKNOWN STEP\t\S+\s/, ""));

        // Map each failure block ("  N) <test> ──") to its error lines.
        const blocks = [];
        let cur = null;
        for (const line of content) {
          const m = line.match(/^\s*\d+\)\s+(.*?)\s+─+\s*$/);
          if (m) {
            cur = { name: m[1], text: [] };
            blocks.push(cur);
          } else if (cur && (line === "" || /^\s/.test(line))) {
            cur.text.push(line.trim());
          } else if (/\S/.test(line) && !/^\s/.test(line)) {
            cur = null;
          }
        }
        for (const b of blocks) {
          const text = b.text.join("\n");
          let errorType = "other";
          let pixels = "", ratio = "";
          const newSnap = text.match(/A snapshot doesn.t exist/);
          const diff = text.match(/(\d+)\s+pixels \(ratio ([\d.]+)/);
          if (newSnap) errorType = "missing-baseline";
          else if (diff) {
            errorType = "screenshot-diff";
            [, pixels, ratio] = diff;
          } else if (/toHaveScreenshot/.test(text)) {
            errorType = "screenshot-other";
          }
          console.log([id, sha, b.name, errorType, pixels, ratio].join("\t"));
        }
      ' "$id" "$sha" "$log"
    done
} >"$OUT"

echo "wrote $OUT ($(wc -l <"$OUT") lines)"
