<script lang="ts">
  import {
    addFilterTag,
    removeFilterTag,
    type MissingComponent,
  } from "./viewFilter";

  interface Props {
    /** The open view's `filter.include_tags`. */
    includeTags: string[];
    /** Every tag used in the model, offered as completions. */
    knownTags?: string[];
    /** Tagged components the filter requires but the canvas does not show. */
    missing?: MissingComponent[];
    readonly?: boolean;
    onchange: (tags: string[]) => void;
  }

  let {
    includeTags,
    knownTags = [],
    missing = [],
    readonly = false,
    onchange,
  }: Props = $props();

  let draft = $state("");

  let suggestions = $derived(knownTags.filter((t) => !includeTags.includes(t)));

  function commit(): void {
    const next = addFilterTag(includeTags, draft);
    draft = "";
    if (next.length !== includeTags.length) onchange(next);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "") {
      const last = includeTags[includeTags.length - 1];
      if (last !== undefined) onchange(removeFilterTag(includeTags, last));
    }
  }
</script>

<section data-testid="view-filters" aria-label="Filters">
  <h3
    class="font-semibold text-sm mb-1 text-base-content/70 uppercase tracking-wide"
  >
    Filters
  </h3>
  <p class="text-xs text-base-content/50 mb-2">
    Components tagged with any of these must be shown in this view.
  </p>

  <fieldset disabled={readonly} class="fieldset p-0">
    <label class="fieldset-label text-xs" for="view-filter-tag-input">
      Include tags
    </label>
    <div class="flex flex-wrap gap-1 items-center">
      {#each includeTags as tag (tag)}
        <span
          class="badge badge-primary badge-sm gap-1"
          data-testid="filter-tag"
        >
          {tag}
          <button
            type="button"
            class="cursor-pointer"
            aria-label={`Remove tag ${tag}`}
            onclick={() => onchange(removeFilterTag(includeTags, tag))}
          >
            ✕
          </button>
        </span>
      {/each}
    </div>
    <input
      id="view-filter-tag-input"
      class="input input-sm w-full"
      placeholder="Type a tag, press space"
      list="view-filter-known-tags"
      autocomplete="off"
      bind:value={draft}
      {onkeydown}
      onblur={commit}
    />
    <datalist id="view-filter-known-tags">
      {#each suggestions as tag (tag)}
        <option value={tag}></option>
      {/each}
    </datalist>
  </fieldset>

  {#if includeTags.length > 0}
    {#if missing.length === 0}
      <p class="text-xs text-success mt-2" data-testid="filter-complete">
        Every matching component is shown.
      </p>
    {:else}
      <div
        role="status"
        class="alert alert-warning alert-soft mt-2 p-2 text-xs"
        data-testid="filter-missing"
      >
        <!-- One child, so the alert's grid never puts the list beside the
             heading, whatever the viewport width. -->
        <div>
          <p>
            {missing.length} matching component{missing.length === 1 ? "" : "s"}
            not shown (W023):
          </p>
          <ul class="list-disc ms-4">
            {#each missing as item (item.key)}
              <li title={item.key}>
                {item.label}
                <span class="text-base-content/60"
                  >({item.matchedTags.join(", ")})</span
                >
              </li>
            {/each}
          </ul>
        </div>
      </div>
    {/if}
  {/if}
</section>
