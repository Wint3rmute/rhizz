<script lang="ts">
// Bottom detail pane for the selected definition: tabbed
// Full name / Ports (N) / Requirements (placeholder) / Metadata views,
// plus an Edit button that deep-links into the Modeling editor.
//
// The Full name tab shows the definition's `docs/<label>.md` documentation
// (rendered Markdown) with a viewer/editor toggle; saving writes the file
// back to the project's VFS (creating `docs/` when needed).
import Markdown from "../../../../components/Markdown.svelte";
import { SvelteSet } from "svelte/reactivity";
import type { InventoryDefinition } from "./inventory";
import { definitionDepth } from "./inventory";

let {
  definition,
  editHref,
  docContent,
  ondocsave,
}: {
  definition: InventoryDefinition | null;
  /** Navigate-to URL for the Edit button (deep-link into Modeling). */
  editHref: string | null;
  /** `docs/<label>.md` content: null when missing, undefined while loading. */
  docContent: string | null | undefined;
  /** Persist edited documentation back to the VFS. */
  ondocsave: (content: string) => Promise<void>;
} = $props();

const TABS = ["Full name", "Ports", "Requirements", "Metadata"] as const;
type Tab = (typeof TABS)[number];

let activeTab = $state<Tab>("Full name");

// Reset to the first tab (and the doc viewer) when switching between
// definitions so stale tab/editor state doesn't leak across selections.
let lastLabel = $state<string | null>(null);
let docMode = $state<"view" | "edit">("view");
let editText = $state("");
let savingDoc = $state(false);
$effect(() => {
  const label = definition?.label ?? null;
  if (label !== lastLabel) {
    lastLabel = label;
    activeTab = "Full name";
    docMode = "view";
  }
});

let portCount = $derived(definition?.ports.length ?? 0);
let depth = $derived(definition ? definitionDepth(definition) : 0);

function startDocEdit(): void {
  editText = docContent ?? "";
  docMode = "edit";
}

async function saveDocEdit(): Promise<void> {
  if (savingDoc) return;
  savingDoc = true;
  try {
    await ondocsave(editText);
    docMode = "view";
  } finally {
    savingDoc = false;
  }
}
function flattenTags(def: InventoryDefinition): string[] {
  const tags = new SvelteSet<string>(def.tags);
  const walk = (d: InventoryDefinition) => {
    for (const t of d.tags) tags.add(t);
    for (const c of d.children) walk(c);
  };
  walk(def);
  return [...tags];
}
</script>

<div
  class="border-t border-base-300 bg-base-100 flex flex-col min-h-[180px]"
  data-testid="inventory-detail-pane"
>
  {#if !definition}
    <div
      class="flex-1 flex items-center justify-center text-sm text-base-content/50 p-4"
    >
      Select an entity in the Inventory Browser to inspect it.
    </div>
  {:else}
    <div
      class="flex items-center justify-between border-b border-base-300 px-2"
      role="tablist"
      aria-label="Entity details"
    >
      <div class="flex items-center">
        {#each TABS as tab (tab)}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            class="px-3 py-2 text-sm border-b-2 -mb-px transition-colors {
              activeTab === tab
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-base-content/60 hover:text-base-content'
            }"
            onclick={() => (activeTab = tab)}
          >
            {tab}{#if tab === "Ports"} ({portCount}){/if}
          </button>
        {/each}
      </div>
      {#if editHref}
        <a
          href={editHref}
          class="btn btn-ghost btn-sm gap-1.5"
          aria-label="Edit {definition.label} in the Modeling editor"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 512 512"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.7C-1.5 490.4 5.6 498.6 14.7 497.5l120.8-15.4c14.1-1.8 27-8.1 37.4-18.5L405.3 130.5 291.7 19.3zM112 480c0-8.8-7.2-16-16-16H80c-8.8 0-16 7.2-16 16s7.2 16 16 16h16c8.8 0 16-7.2 16-16z"
            />
          </svg>
          Edit
        </a>
      {/if}
    </div>

    <div class="flex-1 overflow-y-auto p-4 text-sm">
      {#if activeTab === "Full name"}
        {#if docMode === "edit"}
          <textarea
            data-testid="inventory-doc-textarea"
            bind:value={editText}
            rows={10}
            class="textarea textarea-sm textarea-bordered w-full font-mono"
            placeholder="# {definition.label}\n\nDescribe this component..."
          ></textarea>
          <div class="flex gap-2 mt-2">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="inventory-doc-save-button"
              disabled={savingDoc}
              onclick={() => void saveDocEdit()}
            >
              {savingDoc ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              data-testid="inventory-doc-cancel-button"
              disabled={savingDoc}
              onclick={() => (docMode = "view")}
            >
              Cancel
            </button>
          </div>
        {:else}
          <div data-testid="inventory-doc-viewer">
            {#if docContent === undefined}
              <p class="text-base-content/50 italic">
                Loading documentation…
              </p>
            {:else if docContent === null}
              <p class="text-base-content/50 italic">
                No documentation yet — write it here; it is stored as
                <code>docs/{definition.label}.md</code>.
              </p>
              <button
                type="button"
                class="btn btn-outline btn-sm btn-primary mt-2"
                data-testid="inventory-doc-edit-button"
                onclick={startDocEdit}
              >
                Add documentation
              </button>
            {:else}
              <div class="flex items-center justify-between mb-2">
                <span
                  class="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                  Documentation
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  data-testid="inventory-doc-edit-button"
                  onclick={startDocEdit}
                >
                  Edit
                </button>
              </div>
              <Markdown content={docContent} />
            {/if}
          </div>
        {/if}
      {:else if activeTab === "Ports"}
        {#if definition.ports.length === 0}
          <p class="text-base-content/50 italic">This definition has no ports.</p>
        {:else}
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Port</th>
                <th>Protocol</th>
                <th>Role</th>
                <th>External</th>
                <th>Required</th>
              </tr>
            </thead>
            <tbody>
              {#each definition.ports as port (port.label)}
                <tr>
                  <td class="font-medium">{port.label}</td>
                  <td>{port.protocol || "—"}</td>
                  <td>{port.role}</td>
                  <td>{port.external ? "yes" : "no"}</td>
                  <td>{port.required ? "yes" : "no"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {:else if activeTab === "Requirements"}
        <p class="text-base-content/50 italic">
          Requirements tracing is not available yet — this tab is a placeholder
          for future requirement links.
        </p>
      {:else if activeTab === "Metadata"}
        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
          <dt class="text-base-content/60">Label</dt>
          <dd class="font-medium">{definition.label}</dd>
          <dt class="text-base-content/60">Kind</dt>
          <dd>definition</dd>
          <dt class="text-base-content/60">Hierarchy level</dt>
          <dd>L{depth}</dd>
          <dt class="text-base-content/60">Leaf</dt>
          <dd>{definition.leaf ? "yes" : "no"}</dd>
          {#if definition.icon}
            <dt class="text-base-content/60">Icon</dt>
            <dd>{definition.icon}</dd>
          {/if}
          {#if definition.color}
            <dt class="text-base-content/60">Color</dt>
            <dd>{definition.color}</dd>
          {/if}
          {#if definition.border}
            <dt class="text-base-content/60">Border</dt>
            <dd>{definition.border}</dd>
          {/if}
          {#if definition.font}
            <dt class="text-base-content/60">Font</dt>
            <dd>{definition.font}</dd>
          {/if}
          <dt class="text-base-content/60">Tags</dt>
          <dd>
            {#if flattenTags(definition).length === 0}
              <span class="text-base-content/50">none</span>
            {:else}
              <div class="flex flex-wrap gap-1">
                {#each flattenTags(definition) as tag (tag)}
                  <span class="badge badge-ghost badge-sm">{tag}</span>
                {/each}
              </div>
            {/if}
          </dd>
          <dt class="text-base-content/60">Child components</dt>
          <dd>{definition.children.length}</dd>
        </dl>
      {/if}
    </div>
  {/if}
</div>
