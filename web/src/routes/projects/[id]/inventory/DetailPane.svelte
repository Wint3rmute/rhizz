<script lang="ts">
// Detail pane for the selected definition: one tab per facet of it.
//
// A column of the workspace, not a strip under the canvas — the parent row
// gives it two fifths from `md:` up and drops it below the diagram on narrow
// screens, which is why the border side is switched rather than drawn on all
// four. The Description tab edits `docs/<label>.md` in the app's `MonacoEditor`,
// the same component the Code page uses for these very files.
import Markdown from "../../../../components/Markdown.svelte";
import MonacoEditor from "../../../../components/MonacoEditor.svelte";
import ComponentStyleFields from "../../../../components/ComponentStyleFields.svelte";
import { SvelteSet } from "svelte/reactivity";
// Type-only: the editor *type* without dragging the editor itself in, so
// `DetailPane` does not become a second reason to load Monaco.
import type * as monaco from "monaco-editor";
import type { ComponentPatch } from "../../../../actionLog";
import type { InventoryDefinition } from "./inventory";
import { definitionDepth } from "./inventory";
import {
  DEFAULT_COLOR,
  DEFAULT_FONT,
} from "../modeling/visuals";

let {
  definition,
  docContent,
  ondocsave,
  onstylechange,
}: {
  definition: InventoryDefinition | null;
  /** `docs/<label>.md` content: null when missing, undefined while loading. */
  docContent: string | null | undefined;
  /** Persist edited documentation back to the VFS. */
  ondocsave: (content: string) => Promise<void>;
  /**
   * Persist a component-style edit to the system model. Omitted when the
   * entity has no component to style (a system), which is also what hides the
   * Style tab — a tab whose controls would silently refuse is worse than no
   * tab, because nothing on screen says the edit went nowhere.
   */
  onstylechange?: ((patch: ComponentPatch) => Promise<void>) | undefined;
} = $props();

const TABS = ["Description", "Ports", "Requirements", "Metadata"] as const;
// `Style` sits second, right after the description: it is the tab a user
// comes for on a component, and the only one that edits the model. It is
// absent when there is nothing to style (see `onstylechange`).
type Tab = "Description" | "Style" | "Ports" | "Requirements" | "Metadata";

let tabs = $derived(
  onstylechange === undefined
    ? TABS
    : (["Description", "Style", ...TABS.slice(1)] as Tab[]),
);

// Monaco options for the documentation editor, as one object so the identity is
// stable (see `MonacoEditor`: options are read at create time, untracked).
const DOC_EDITOR_OPTIONS = {
  // Prose wraps; Monaco's markdown configuration sets no `wordWrap`, so
  // without this a paragraph is one long horizontal scroll in a pane that is
  // two fifths of a row.
  wordWrap: "on",
  // No minimap: it is a map of a file you cannot scroll in a pane this narrow,
  // and for a document of a few paragraphs it is dots. The Code page keeps its
  // own, where files are long and the pane is wide.
  minimap: { enabled: false },
  // No occurrence highlighting: in Markdown it paints every other instance of
  // the word under the cursor, which is noise in a document rather than a
  // signal in code. It also keeps Monaco's word highlighter from scheduling
  // its debounce work, which rejects a promise nobody awaits when the editor
  // is disposed — an unhandled rejection that fails the story suite.
  occurrencesHighlight: "off",
} as const satisfies monaco.editor.IStandaloneEditorConstructionOptions;

let activeTab = $state<Tab>("Description");

// The live Monaco instance while the doc editor is mounted. Only used to put
// the cursor in the document when the editor opens — see the effect below.
let docEditor = $state<monaco.editor.IStandaloneCodeEditor | undefined>(
  undefined,
);

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
    activeTab = "Description";
    docMode = "view";
  }
});

let portCount = $derived(definition?.ports.length ?? 0);
let depth = $derived(definition ? definitionDepth(definition) : 0);

// Opening the editor should put you *in* the document, not leave you to click
// into it first — the point of "Edit" is to start typing. The handle arrives a
// tick after `docMode` flips (the component mounts then), so this waits for
// whichever of the two is still missing.
$effect(() => {
  if (docMode === "edit") docEditor?.focus();
});

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
  class="border-base-300 bg-base-100 flex flex-col min-h-[180px] md:min-h-0 md:w-2/5 md:min-w-0 border-t md:border-t-0 md:border-l"
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
      class="flex items-center border-b border-base-300 px-2"
      role="tablist"
      aria-label="Entity details"
    >
      {#each tabs as tab (tab)}
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

    <div class="flex-1 min-h-0 overflow-auto p-4 text-sm flex flex-col">
      {#if activeTab === "Description"}
        {#if docMode === "edit"}
          <div class="flex-1 min-h-0 flex flex-col gap-2">
            <!-- Monaco, not a textarea: the Code page already edits Markdown in
                 it, so docs read and write the same way wherever you open
                 them. -->
            <div
              data-testid="inventory-doc-editor"
              class="flex-1 min-h-[200px] overflow-hidden rounded border border-base-300"
            >
              <MonacoEditor
                bind:value={editText}
                bind:editor={docEditor}
                language="markdown"
                options={DOC_EDITOR_OPTIONS}
              />
            </div>
            <div class="flex gap-2">
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
      {:else if activeTab === "Style" && onstylechange !== undefined}
        <!--
          The same `ComponentStyleFields` Modeling's inspector uses, editing
          the same `system.hcl` attributes. They were listed read-only here
          before, which meant the Inventory could tell you a component's color
          but not change it -- the only way to edit was to find the node on the
          Modeling canvas. Metadata no longer repeats them: a value shown twice
          in the same pane, once editable and once not, reads as a bug in one
          of them.
        -->
        <div data-testid="inventory-style-fields">
          <ComponentStyleFields
            style={{
              full_name: definition.full_name,
              icon: definition.icon,
              // The definition carries the raw attribute; the controls want
              // the explicit default the select shows for "unset", which is
              // what the read model normalizes an absent value to.
              color: definition.color || DEFAULT_COLOR,
              border: definition.border || "solid",
              font: definition.font || DEFAULT_FONT,
            }}
            onchange={(patch) => void onstylechange(patch)}
          />
        </div>
      {:else if activeTab === "Ports"}
        {#if definition.ports.length === 0}
          <p class="text-base-content/50 italic">
            This definition has no ports.
          </p>
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
