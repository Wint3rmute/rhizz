<script lang="ts">
import { resolveIcon, searchIcons } from "../iconHelper";

interface Props {
  value?: string;
  placeholder?: string;
  label?: string;
  id?: string;
  onchange?: (value: string) => void;
}

let {
  value = $bindable(""),
  placeholder = "e.g. microchip, server, database, wifi",
  label = "Icon (FontAwesome)",
  id = "icon-autocomplete-input",
  onchange,
}: Props = $props();

let isFocused = $state(false);
let suggestions = $derived(isFocused ? searchIcons(value, 8) : []);
let activeIcon = $derived(resolveIcon(value));

function handleSelect(iconName: string) {
  value = iconName;
  isFocused = false;
  onchange?.(iconName);
}

function handleInput(e: Event) {
  const inputVal = (e.target as HTMLInputElement).value;
  value = inputVal;
  onchange?.(inputVal.trim());
}

function handleBlur() {
  // Slight delay so mousedown on suggestion list item fires before dropdown closes
  setTimeout(() => {
    isFocused = false;
  }, 150);
}
</script>

<div class="form-control relative w-full"
  data-testid="icon-autocomplete-wrapper">
  {#if label}
    <label class="label py-1" for={id}>
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70"
      >
        {label}
      </span>
    </label>
  {/if}

  <div class="flex items-center gap-2">
    <!-- Icon Placeholder Box on the left (fixed size, never shifts the textbox) -->
    <div
      class="w-8 h-8 shrink-0 rounded border flex items-center justify-center transition-colors {activeIcon
        ? 'bg-base-200 border-base-300 text-primary shadow-xs'
        : 'bg-base-200/40 border-base-300/60 text-base-content/20'}"
      title={activeIcon ? `Icon: ${value}` : "No icon selected"}
      data-testid="icon-placeholder-box"
    >
      {#if activeIcon}
        <svg
          viewBox="0 0 {activeIcon.width} {activeIcon.height}"
          class="w-4 h-4 fill-current"
          aria-hidden="true"
        >
          <path d={activeIcon.svgPath} />
        </svg>
      {:else}
        <span class="text-[10px] select-none opacity-40 font-mono">∅</span>
      {/if}
    </div>

    <!-- Input and dropdown container -->
    <div class="relative flex-1 flex items-center">
      <input
        {id}
        type="text"
        bind:value
        oninput={handleInput}
        onfocus={() => (isFocused = true)}
        onblur={handleBlur}
        class="input input-sm input-bordered w-full font-mono text-xs pr-7"
        {placeholder}
        autocomplete="off"
      />

      {#if value}
        <button
          type="button"
          class="btn btn-xs btn-ghost btn-circle absolute right-1 text-base-content/40 hover:text-base-content"
          onclick={() => handleSelect("")}
          title="Clear icon"
        >
          ✕
        </button>
      {/if}

      {#if isFocused && suggestions.length > 0}
        <ul
          class="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto rounded-box bg-base-200 p-1 shadow-lg border border-base-300 space-y-0.5 text-xs font-mono"
          data-testid="icon-suggestions-list"
        >
          {#each suggestions as { name, icon } (name)}
            <li>
              <button
                type="button"
                class="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded hover:bg-base-300 text-left transition-colors {value
                  .toLowerCase()
                  .replace(/^fa-?/, '') === name
                  ? 'bg-primary/15 text-primary font-bold'
                  : ''}"
                onmousedown={() => handleSelect(name)}
              >
                <svg
                  viewBox="0 0 {icon.width} {icon.height}"
                  class="w-3.5 h-3.5 shrink-0 fill-current"
                  aria-hidden="true"
                >
                  <path d={icon.svgPath} />
                </svg>
                <span class="flex-1 truncate">{name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>
