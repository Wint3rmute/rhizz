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
  warningLevel = null,
  levelPinned = false,
}: {
  status: VerdictStatus;
  head: string;
  errors?: VerdictDiagnostic[];
  warnings?: VerdictDiagnostic[];
  stats?: VerdictStats | null;
  /** Strictness the verdict was compiled at; shown as a badge so embed readers see the mode. */
  warningLevel?: string | null;
  /** True when the level was pinned per-embed (book `?level=`), not inherited from the app preset. */
  levelPinned?: boolean;
} = $props();

const glyph = $derived(
  status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗",
);

const alertClass = $derived(
  status === "ok"
    ? "alert-success"
    : status === "warn"
    ? "alert-warning"
    : "alert-error",
);
</script>

<div role="alert" class="alert alert-soft {alertClass} block text-sm">
  <div class="flex items-center justify-between gap-2 font-semibold">
    <span>{glyph} {head}</span>
    {#if warningLevel}
      <span
        class="whitespace-nowrap text-xs font-medium opacity-70"
        title={levelPinned
          ? `Strictness pinned to ${warningLevel} by this example — warnings below that detail are hidden`
          : `Strictness ${warningLevel} from the app preset — warnings below that detail are hidden`}>
        Strictness: {warningLevel}
      </span>
    {/if}
  </div>
  {#if errors.length > 0}
    <ul class="verdict-list verdict-errors w-full list-none m-0 py-1 pr-2 pl-8 max-h-48 overflow-auto text-left">
      {#each errors as diagnostic, i (i)}
        <li class="py-px">
          <span class="font-mono font-bold">{diagnostic.code}</span>—
          {diagnostic.message}
        </li>
      {/each}
    </ul>
  {/if}
  {#if warnings.length > 0}
    <ul class="verdict-list verdict-warnings w-full list-none m-0 py-1 pr-2 pl-8 max-h-48 overflow-auto text-left">
      {#each warnings as diagnostic, i (i)}
        <li class="py-px">
          <span class="font-mono font-bold">{diagnostic.code}</span>—
          {diagnostic.message}
        </li>
      {/each}
    </ul>
  {/if}
  {#if stats}
    <ul class="w-full list-none flex flex-wrap gap-x-6 gap-y-1 m-0 px-2 pt-2">
      {#each stats.rows as row (row.label)}
        <li>
          <span class="opacity-70">{row.label}</span><b class="ml-1">{row.complete}/{row.total}</b>
        </li>
      {/each}
      <li>
        <span class="opacity-70">Overall</span><b class="ml-1">{stats.overall.toFixed(1)}%</b>
      </li>
    </ul>
  {/if}
</div>

<style>
/* Only the diagnostic glyphs stay custom: status colors, dark theme and
   layout all come from daisyUI (`alert alert-soft`) + Tailwind above. */
.verdict-warnings li::before {
  content: "⚠️ ";
}
.verdict-errors li::before {
  content: "❌ ";
}
/* `alert-soft` paints text in the raw status color, which is unreadable on
   a light background (bright green/yellow on near-white). Darken it there;
   the dark theme already reads fine. */
:global(html[data-theme="light"]) .alert-soft {
  color: color-mix(in oklab, var(--alert-color) 55%, black);
}
</style>
