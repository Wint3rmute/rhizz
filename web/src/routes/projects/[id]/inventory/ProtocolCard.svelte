<script lang="ts">
  // One protocol card in the Inventory Browser sidebar: label, a `leaf` badge,
  // the number of ports that use it, and its full name. Purely presentational,
  // the same shape as DefinitionCard.
  import type { ProtocolData } from "../../../../modelView";

  let {
    protocol,
    portCount,
    selected = false,
    onselect,
  }: {
    protocol: ProtocolData;
    /** How many ports name this protocol. */
    portCount: number;
    selected?: boolean;
    onselect?: (label: string) => void;
  } = $props();
</script>

<button
  type="button"
  class="w-full text-left rounded-lg border p-3 transition-colors {selected
    ? 'bg-base-200 border-primary/60 ring-1 ring-primary/40'
    : 'bg-base-100 border-base-300 hover:bg-base-200/60'}"
  onclick={() => onselect?.(protocol.label)}
  aria-pressed={selected}
  data-testid="inventory-protocol-card"
>
  <div class="flex flex-wrap items-center gap-1.5">
    <span class="font-mono font-semibold text-sm truncate">
      {protocol.label}
    </span>
    {#if protocol.leaf}
      <span class="badge badge-ghost badge-sm">leaf</span>
    {/if}
    <span class="badge badge-ghost badge-sm">
      {portCount}
      {portCount === 1 ? "port" : "ports"}
    </span>
  </div>
  {#if protocol.full_name}
    <p class="mt-1 text-xs text-base-content/60 line-clamp-2">
      {protocol.full_name}
    </p>
  {/if}
</button>
