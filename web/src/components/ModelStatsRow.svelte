<script lang="ts">
  interface Props {
    componentCount: number;
    leafCount: number;
    compositeCount: number;
    portCount: number;
    portsPct: number;
    connectionCount: number;
    connectionsPct: number;
    overallPct: number;
    messageCount: number;
  }

  let {
    componentCount,
    leafCount,
    compositeCount,
    portCount,
    portsPct,
    connectionCount,
    connectionsPct,
    overallPct,
    messageCount,
  }: Props = $props();
</script>

<div class="stats stats-vertical sm:stats-horizontal shadow bg-base-200 w-full">
  <div class="stat">
    <div class="stat-figure text-primary">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
        />
      </svg>
    </div>
    <div class="stat-title text-base-content/60">Components</div>
    <div class="stat-value text-base-content">{componentCount}</div>
    <div class="stat-desc text-base-content/50">
      {leafCount} atomic · {compositeCount} composite
    </div>
  </div>

  <div class="stat">
    <div class="stat-figure text-secondary">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
    </div>
    <div class="stat-title text-base-content/60">Ports</div>
    <div class="stat-value text-base-content">{portCount}</div>
    <div class="stat-desc text-base-content/50">{portsPct}% defined</div>
  </div>

  <div class="stat">
    <div class="stat-figure text-accent">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    </div>
    <div class="stat-title text-base-content/60">Connections</div>
    <div class="stat-value text-base-content">{connectionCount}</div>
    <div class="stat-desc text-base-content/50">{connectionsPct}% defined</div>
  </div>

  <div class="stat">
    <div class="stat-figure text-success">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </div>
    <div class="stat-title text-base-content/60">Completion</div>
    <div
      class="stat-value {overallPct >= 80 ? 'text-success' : overallPct >= 50 ? 'text-warning' : 'text-error'}"
    >
      {overallPct}%
    </div>
    <div class="stat-desc text-base-content/50">{messageCount} messages defined</div>
  </div>
</div>
