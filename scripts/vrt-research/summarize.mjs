#!/usr/bin/env node
// Aggregate Playwright JSON reports (from run-local.sh or CI experiment runs)
// into a per-test flake table.
//
// usage: summarize.mjs <label> <dir-containing-report.json>...
//
// Every directory that holds a report.json (walked recursively) counts as one
// run. Output (also written to .vrt-research/summaries/<label>.{csv,md}):
//   - per test: runs seen, failures, flake rate, distinct error messages,
//     max diff pixels/ratio
//   - runs with at least one failure, and suite duration min/mean/max.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const [label, ...roots] = process.argv.slice(2);
if (!label || roots.length === 0) {
  console.error("usage: summarize.mjs <label> <dir-containing-report.json>...");
  process.exit(1);
}

function findReports(root) {
  const out = [];
  const walk = (dir) => {
    const report = join(dir, "report.json");
    if (existsSync(report)) {
      out.push(dir);
      return;
    }
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (existsSync(full) && statSync(full).isDirectory()) walk(full);
    }
  };
  walk(resolve(root));
  return out;
}

const runDirs = roots.flatMap(findReports);

const stats = new Map(); // test id -> { runs, failures, errors: Map, maxPx, maxRatio }
const durations = [];
let failingRuns = 0;

for (const dir of runDirs) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
  } catch {
    console.error(`skip (unparseable): ${dir}/report.json`);
    failingRuns++;
    continue;
  }
  durations.push((parsed.stats?.duration ?? 0) / 1000);
  let runFailed = false;
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      const file = suite.file ?? "";
      const id = `${file}:${spec.line}> ${spec.title}`;
      for (const t of spec.tests) {
        const last = t.results.at(-1);
        const status = last.status;
        const entry =
          stats.get(id) ??
          { runs: 0, failures: 0, errors: new Map(), maxPx: 0, maxRatio: 0 };
        entry.runs++;
        if (status !== "passed" && status !== "skipped") {
          entry.failures++;
          runFailed = true;
          const px = /(\d+) pixels \(ratio ([\d.]+)/.exec(last.error?.message ?? "");
          if (px) {
            entry.maxPx = Math.max(entry.maxPx, Number(px[1]));
            entry.maxRatio = Math.max(entry.maxRatio, Number(px[2]));
          }
          const message = (last.error?.message ?? "").replace(/\s+/g, " ").trim();
          const key = px
            ? `screenshot-diff ${px[1]} px (ratio ${px[2]})`
            : message.split(":")[0].slice(0, 60) || status;
          entry.errors.set(key, (entry.errors.get(key) ?? 0) + 1);
        }
        stats.set(id, entry);
      }
    }
  };
  for (const s of parsed.suites) walk(s);
  if (runFailed) failingRuns++;
}

const rows = [...stats.entries()]
  .map(([id, e]) => ({
    id,
    runs: e.runs,
    failures: e.failures,
    rate: e.failures / Math.max(1, e.runs),
    errors: [...e.errors.entries()].map(([k, n]) => `${n}x ${k}`).join("; "),
    maxPx: e.maxPx,
    maxRatio: e.maxRatio,
  }))
  .sort((a, b) => b.failures - a.failures || a.id.localeCompare(b.id));

const csv = [
  "test,runs,failures,flake_rate,max_pixels,max_ratio,errors",
  ...rows.map((r) =>
    [
      JSON.stringify(r.id),
      r.runs,
      r.failures,
      r.rate.toFixed(4),
      r.maxPx || "",
      r.maxRatio || "",
      JSON.stringify(r.errors),
    ].join(","),
  ),
];

const md = [
  `# ${label} — ${runDirs.length} runs, ${failingRuns} with >=1 failure (${(
    (100 * failingRuns) /
    Math.max(1, runDirs.length)
  ).toFixed(1)}%)`,
  "",
  "| test | runs | failures | flake rate | max px | errors |",
  "|---|---|---|---|---|---|",
  ...rows
    .filter((r) => r.failures > 0)
    .map(
      (r) =>
        `| ${r.id} | ${r.runs} | ${r.failures} | ${(100 * r.rate).toFixed(1)}% | ${
          r.maxPx || "-"
        } | ${r.errors || "-"} |`,
    ),
];

const durSec = durations.map((d) => +d.toFixed(1));
const durLine = durations.length
  ? `Suite duration (playwright-reported): min ${Math.min(...durations).toFixed(0)}s / mean ${(
      durations.reduce((a, b) => a + b, 0) / durations.length
    ).toFixed(0)}s / max ${Math.max(...durations).toFixed(0)}s`
  : "no durations";

const outDir = ".vrt-research/summaries";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${label}.csv`), csv.join("\n") + "\n");
writeFileSync(join(outDir, `${label}.md`), md.join("\n") + "\n\n" + durLine + "\n");

console.log(md.join("\n"));
console.log("\n" + durLine);
console.log(`wrote ${join(outDir, `${label}.csv`)} and ${join(outDir, `${label}.md`)}`);
