<script lang="ts">
  // Presentational network-activity pill: spinner plus the current label.
  // The live state comes from the `netActivity` singleton via the parent
  // (DiagnosticsStatusBar); stories and tests pass explicit props instead,
  // so the visuals stay deterministic without touching global state.
  let {
    label,
    error = null,
    fading = false,
  }: {
    /** Active (or final, while fading) label, e.g. `Uploading…`. */
    label: string;
    /** Error label when the last settle failed, else null. */
    error?: string | null;
    /** True while the settled label is fading out. */
    fading?: boolean;
  } = $props();

  let shown = $derived(error ?? label);
  let isError = $derived(error !== null);
</script>

<span
  role="status"
  data-testid="net-activity"
  data-fading={fading ? "true" : "false"}
  data-error={isError ? "true" : "false"}
  class="inline-flex items-center gap-1.5 text-xs transition-opacity duration-500 motion-reduce:transition-none {fading
    ? 'opacity-0'
    : 'opacity-100'} {isError ? 'text-error' : 'text-base-content/60'}"
>
  {#if !isError}
    <span
      class="loading loading-bars loading-xs net-activity-spinner"
      aria-hidden="true"
    ></span>
  {:else}
    <span aria-hidden="true">⚠</span>
  {/if}
  <span>{shown}</span>
</span>

<style>
  /* DaisyUI's `loading-bars` animates via SMIL inside its mask-image, which
     Playwright's `animations: disabled` cannot freeze (and which still runs,
     only slower, under `prefers-reduced-motion: reduce`). VRT runs with
     reduced motion, so without this the Active story never takes two
     identical screenshots. Under reduced motion swap the animated mask for
     a static three-bars mask: calm for motion-sensitive users and stable
     for screenshots, while everyone else keeps the animated bars. */
  @media (prefers-reduced-motion: reduce) {
    .net-activity-spinner {
      mask-image: url("data:image/svg+xml,%3Csvg width='24' height='24' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='1' y='4' width='6' height='16'/%3E%3Crect x='9' y='1' width='6' height='22'/%3E%3Crect x='17' y='4' width='6' height='16'/%3E%3C/svg%3E") !important;
    }
  }
</style>
