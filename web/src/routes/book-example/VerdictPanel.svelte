<script lang="ts">
import type { DiagnosticJS } from "rhizz";

export type VerdictStatus = "ok" | "warn" | "error";

export interface VerdictStatRow {
  label: string;
  complete: number;
  total: number;
}

export interface VerdictStats {
  rows: VerdictStatRow[];
  overall: number;
}

type VerdictDiagnostic = Pick<DiagnosticJS, "code" | "message">;

let {
  status,
  head,
  errors = [],
  warnings = [],
  stats = null,
}: {
  status: VerdictStatus;
  head: string;
  errors?: VerdictDiagnostic[];
  warnings?: VerdictDiagnostic[];
  stats?: VerdictStats | null;
} = $props();

const glyph = $derived(
  status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗",
);
</script>

<div class="verdict" data-status={status}>
  <div class="verdict-head">{glyph} {head}</div>
  {#if errors.length > 0}
    <ul class="verdict-list verdict-errors">
      {#each errors as diagnostic, i (i)}
        <li>
          <span class="verdict-code">{diagnostic.code}</span>—
          {diagnostic.message}
        </li>
      {/each}
    </ul>
  {/if}
  {#if warnings.length > 0}
    <ul class="verdict-list verdict-warnings">
      {#each warnings as diagnostic, i (i)}
        <li>
          <span class="verdict-code">{diagnostic.code}</span>—
          {diagnostic.message}
        </li>
      {/each}
    </ul>
  {/if}
  {#if stats}
    <ul class="verdict-stats">
      {#each stats.rows as row (row.label)}
        <li>
          <span>{row.label}</span><b>{row.complete}/{row.total}</b>
        </li>
      {/each}
      <li>
        <span>Overall</span><b>{stats.overall.toFixed(1)}%</b>
      </li>
    </ul>
  {/if}
</div>

<style>
/* Classic rhizz verdict panels (see book/css/rhizz.css), restyled for the
   app with explicit light/dark palettes. */
.verdict {
  border: 1px solid;
  border-radius: 6px;
  font-size: 0.9em;
  overflow: hidden;
}
.verdict-head {
  padding: 0.45rem 0.8rem;
  font-weight: 600;
}
.verdict-list {
  list-style: none;
  margin: 0;
  padding: 0.4rem 0.8rem 0.6rem 2rem;
  max-height: 12rem;
  overflow: auto;
}
.verdict-list li {
  padding: 0.1rem 0;
}
.verdict-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 700;
}
.verdict-stats {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.4rem;
  margin: 0;
  padding: 0.5rem 0.8rem;
  border-top: 1px dashed;
}
.verdict-stats span {
  opacity: 0.7;
}
.verdict-stats b {
  margin-left: 0.3em;
}

.verdict[data-status="ok"] {
  border-color: #2e7d32;
  background: #f1f8f1;
}
.verdict[data-status="ok"] .verdict-head {
  background: #2e7d32;
  color: #ffffff;
}
.verdict[data-status="ok"] .verdict-stats {
  border-top-color: #2e7d32;
}
.verdict[data-status="warn"] {
  border-color: #e6a700;
  background: #fffbe9;
}
.verdict[data-status="warn"] .verdict-head {
  background: #e6a700;
  color: #3a2a00;
}
.verdict[data-status="warn"] .verdict-list li {
  color: #7a4f01;
}
.verdict[data-status="warn"] .verdict-stats {
  border-top-color: #e6a700;
}
.verdict[data-status="error"] {
  border-color: #c62828;
  background: #fdf1f1;
}
.verdict[data-status="error"] .verdict-head {
  background: #c62828;
  color: #ffffff;
}
.verdict[data-status="error"] .verdict-list li {
  color: #7f0000;
}
.verdict[data-status="error"] .verdict-stats {
  border-top-color: #c62828;
}
.verdict-warnings li::before {
  content: "⚠️ ";
}
.verdict-errors li::before {
  content: "❌ ";
}

:global(html[data-theme="dark"]) .verdict[data-status="ok"] {
  border-color: #66bb6a;
  background: #16281b;
}
:global(html[data-theme="dark"]) .verdict[data-status="ok"] .verdict-head {
  background: #66bb6a;
  color: #0b2210;
}
:global(html[data-theme="dark"]) .verdict[data-status="ok"] .verdict-stats {
  border-top-color: #66bb6a;
}
:global(html[data-theme="dark"]) .verdict[data-status="warn"] {
  border-color: #f0b72f;
  background: #2b2408;
}
:global(html[data-theme="dark"]) .verdict[data-status="warn"] .verdict-head {
  background: #f0b72f;
  color: #2b2408;
}
:global(html[data-theme="dark"]) .verdict[data-status="warn"] .verdict-list li {
  color: #ffd54f;
}
:global(html[data-theme="dark"]) .verdict[data-status="warn"] .verdict-stats {
  border-top-color: #f0b72f;
}
:global(html[data-theme="dark"]) .verdict[data-status="error"] {
  border-color: #ef5350;
  background: #2b1314;
}
:global(html[data-theme="dark"]) .verdict[data-status="error"] .verdict-head {
  background: #ef5350;
  color: #2b1314;
}
:global(html[data-theme="dark"]) .verdict[data-status="error"] .verdict-list li {
  color: #ff8a80;
}
:global(html[data-theme="dark"]) .verdict[data-status="error"] .verdict-stats {
  border-top-color: #ef5350;
}
</style>
