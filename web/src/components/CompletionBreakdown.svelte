<script lang="ts">
export interface CategoryScore {
  complete: number;
  partial: number;
  incomplete: number;
  pct: number;
}

interface Props {
  overallPct: number;
  completeTotal: number;
  grandTotal: number;
  components: CategoryScore;
  ports: CategoryScore;
  connections: CategoryScore;
  messages: CategoryScore;
}

let {
  overallPct,
  completeTotal,
  grandTotal,
  components,
  ports,
  connections,
  messages,
}: Props = $props();

const rows = $derived([
  {
    label: "Components",
    icon: "▦",
    cat: components,
    color: "progress-primary",
    ring: "text-primary",
  },
  {
    label: "Ports",
    icon: "⚡",
    cat: ports,
    color: "progress-secondary",
    ring: "text-secondary",
  },
  {
    label: "Connections",
    icon: "⇄",
    cat: connections,
    color: "progress-accent",
    ring: "text-accent",
  },
  {
    label: "Messages",
    icon: "✉",
    cat: messages,
    color: "progress-success",
    ring: "text-success",
  },
]);
</script>

<div class="card bg-base-200 shadow">
  <div class="card-body">
    <h2 class="card-title text-base-content mb-6">Completion Breakdown</h2>

    <!-- Radial summary -->
    <div
      class="flex flex-col sm:flex-row items-center gap-6 mb-8 p-4 rounded-xl bg-base-100"
    >
      <div
        class="radial-progress {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'} shrink-0"
        style="--value: {overallPct}; --size: 8rem; --thickness: 8px"
        role="progressbar"
        aria-label="Overall completion"
      >
        <span
          class="text-2xl font-bold {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'}"
        >{overallPct}%</span>
      </div>
      <div class="flex-1 text-center sm:text-left">
        <div class="text-xl font-semibold text-base-content mb-1">
          {#if overallPct === 100}
            Model fully specified
          {:else if overallPct >= 80}
            Nearly complete
          {:else if overallPct >= 50}
            Work in progress
          {:else if overallPct > 0}
            Early stage
          {:else}
            Not yet started
          {/if}
        </div>
        <p class="text-sm text-base-content/60">
          {completeTotal} entities fully specified out of {grandTotal} total
        </p>
        <div
          class="flex gap-4 mt-3 justify-center sm:justify-start text-xs text-base-content/60"
        >
          <span class="flex items-center gap-1">
            <span
              class="inline-block w-2 h-2 rounded-full bg-success"
            ></span>Complete
          </span>
          <span class="flex items-center gap-1">
            <span
              class="inline-block w-2 h-2 rounded-full bg-warning"
            ></span>Partial
          </span>
          <span class="flex items-center gap-1">
            <span
              class="inline-block w-2 h-2 rounded-full bg-base-content/40"
            ></span>Incomplete
          </span>
        </div>
      </div>
    </div>

    <!-- Category grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {#each rows as row}
        {@const total = row.cat.complete + row.cat.partial + row.cat.incomplete}
        <div class="bg-base-100 rounded-xl p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-lg {row.ring}">{row.icon}</span>
              <span class="font-semibold text-base-content">{row.label}</span>
            </div>
            <span
              class="text-lg font-bold tabular-nums {row.cat.pct >= 80 ? 'text-success' : row.cat.pct >= 50 ? 'text-warning' : 'text-error'}"
            >{row.cat.pct}%</span>
          </div>
          <progress
            class="progress {row.color} w-full h-2"
            value={row.cat.pct}
            max="100"
          >
          </progress>
          <div class="flex gap-2 text-xs flex-wrap">
            {#if total === 0}
              <span class="badge badge-sm badge-ghost text-base-content/50"
              >none defined</span>
            {:else}
              <span
                class="badge badge-sm badge-soft badge-success"
              >{row.cat.complete} complete</span>
              <span
                class="badge badge-sm badge-soft badge-warning"
              >{row.cat.partial} partial</span>
              <span class="badge badge-sm badge-ghost text-base-content/50">{
                  row.cat.incomplete
                } incomplete</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
