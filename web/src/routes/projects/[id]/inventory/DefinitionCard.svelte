<script lang="ts">
// One entity card in the Inventory Browser sidebar: icon, label, completion
// + level badges, and a short description. Purely presentational.
import { resolveIcon } from "../../../../iconHelper";
import {
  completionBadge,
  definitionDepth,
  type InventoryDefinition,
} from "./inventory";

let {
  definition,
  selected = false,
  onselect,
}: {
  definition: InventoryDefinition;
  selected?: boolean;
  onselect?: (label: string) => void;
} = $props();

let icon = $derived(resolveIcon(definition.icon));
let depth = $derived(definitionDepth(definition));
let badge = $derived(completionBadge(definition));

let badgeClass = $derived(
  badge.kind === "specified"
    ? "badge-success"
    : badge.kind === "partial"
    ? "badge-warning"
    : "badge-ghost",
);
let badgeText = $derived(
  badge.kind === "draft" ? "Draft" : `${badge.percent}% Specified`,
);
</script>

<button
  type="button"
  class="w-full text-left rounded-lg border p-3 transition-colors {
    selected
      ? 'bg-base-200 border-primary/60 ring-1 ring-primary/40'
      : 'bg-base-100 border-base-300 hover:bg-base-200/60'
  }"
  onclick={() => onselect?.(definition.label)}
  aria-pressed={selected}
  data-testid="inventory-card"
>
  <div class="flex items-start gap-2">
    <span class="mt-0.5 shrink-0 text-base-content/80">
      {#if icon}
        <svg
          width="16"
          height="16"
          viewBox="0 0 {icon.width} {icon.height}"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d={icon.svgPath} />
        </svg>
      {:else}
        <svg
          width="16"
          height="16"
          viewBox="0 0 448 512"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            d="M96 0C43 0 0 43 0 96V416c0 53 43 96 96 96H384c32 0 64-10 64-32V448c0-32-64-32-64-32V288c0-16-16-16-16-16H96c-32 0-32-64 0-64h272c16 0 16-16 16-16V32c0-16-16-16-16-16H96z"
          />
        </svg>
      {/if}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="font-semibold text-sm truncate">
          {definition.label}
        </span>
        <span class="badge {badgeClass} badge-sm badge-soft font-medium">
          {badgeText}
        </span>
        <span class="badge badge-ghost badge-sm">L{depth}</span>
      </div>
      {#if definition.description}
        <p class="mt-1 text-xs text-base-content/60 line-clamp-2">
          {definition.description}
        </p>
      {/if}
    </div>
  </div>
</button>
