<script lang="ts">
// The project's completion score, as the diagnostics bar shows it: one badge
// at the far left of the strip.
//
// It takes the score as a prop instead of reading the ProjectState singleton
// itself, so it renders whatever it is handed — and renders nothing at all when
// that is `null`. Which is a real state, not a hypothetical one: only Modeling
// compiles a model and publishes a score, so on the other project pages the
// bar's left end is empty by design rather than showing a "0%" that would read
// as a verdict.
let {
  score,
}: {
  /** `null` until some page has compiled a model and published its score. */
  score: { overall_percentage: number } | null;
} = $props();
</script>

{#if score !== null}
  <div
  class="badge badge-sm badge-outline badge-info font-medium text-xs"
  title={`Architecture maturity / completion score: ${score.overall_percentage.toFixed(1)}%`}
>
    Score: {score.overall_percentage.toFixed(0)}%
  </div>
{/if}
