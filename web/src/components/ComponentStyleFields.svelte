<script lang="ts">
// The component attributes that decide how a node *looks*, as one editable
// block: full name, icon, color, border, font.
//
// Shared by Modeling's node inspector and the Inventory page's Style tab,
// because they edit the same `system.hcl` attributes and were drifting apart
// — the Inventory showed the same four values as read-only text in its
// Metadata tab, so the only way to change them was to go to Modeling and know
// which node to select. One component means one set of controls and one
// write path; a style added here appears on both pages at once.
//
// Deliberately not here: tags, `leaf`, and ports. They are attributes too, but
// they are not presentation — they change what the model *means*, and putting
// them next to a color picker would say otherwise. Modeling keeps them in its
// own component panel; the Inventory shows tags read-only in Metadata.
import IconAutocompleteInput from "./IconAutocompleteInput.svelte";
import type { ComponentPatch } from "../actionLog";
import {
  BORDER_OPTIONS,
  type BorderStyle,
  COLOR_OPTIONS,
  type ComponentColor,
  DEFAULT_FONT,
  FONT_OPTIONS,
} from "../routes/projects/[id]/modeling/visuals";

interface Props {
  /** Current values; absent/empty means the explicit default is selected. */
  style: {
    full_name?: string | undefined;
    icon?: string | undefined;
    color: ComponentColor;
    border: BorderStyle;
    font: string;
  };
  /**
   * One attribute changed. Deliberately `ComponentPatch` and not a narrower
   * style-only type: it is what both call sites already speak (the inspector's
   * `onupdate` and the Inventory's `onstylechange`), so a second name for the
   * same shape would be one more thing to keep in step.
   */
  onchange: (patch: ComponentPatch) => void;
}

let { style, onchange }: Props = $props();

// The full name is a textarea committed on blur, so the draft is local: a
// half-typed name must not rewrite the model on every keystroke, and an
// abandoned edit must revert rather than persist. Writable derived rather
// than `$state` + `$effect`, which would be the same thing with an extra
// frame: the model value is the fallback, and the draft only diverges while
// the field is being edited.
let editedFullName: string | undefined = $state(undefined);
let draftFullName = $derived(editedFullName ?? style.full_name ?? "");

function commitFullName() {
  // Only a changed draft commits; blur on an untouched field must not write.
  if (draftFullName !== (style.full_name ?? "")) {
    onchange({ full_name: draftFullName });
  }
  editedFullName = undefined;
}
</script>

<!-- One field caption. Four controls repeat it verbatim, and the `for` has to
     track the control's id by hand in each. -->
{#snippet fieldLabel(id: string, text: string)}
  <label class="label py-1" for={id}>
  <span
    class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70"
  >
      {text}
    </span>
</label>
{/snippet}

<div class="space-y-2" data-testid="component-style-fields">
  <div class="form-control">
    {@render fieldLabel("comp-fullname-input", "Full name")}
    <textarea
      id="comp-fullname-input"
      bind:value={draftFullName}
      onblur={commitFullName}
      class="textarea textarea-sm textarea-bordered w-full resize-y h-16"
      placeholder="Full official name, expanding abbreviations..."
    ></textarea>
  </div>

  <IconAutocompleteInput
    id="comp-icon-input"
    value={style.icon || ""}
    onchange={(newIcon) => onchange({ icon: newIcon || undefined })}
  />

  <div class="form-control">
    {@render fieldLabel("comp-color-input", "Color")}
    <select
      id="comp-color-input"
      value={style.color}
      onchange={(e) =>
        onchange({ color: (e.target as HTMLSelectElement).value as ComponentColor })}
      class="select select-sm select-bordered w-full"
    >
      <option value="default">Default</option>
      {#each COLOR_OPTIONS as option (option)}
        <option value={option}>
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </option>
      {/each}
    </select>
  </div>

  <div class="form-control">
    {@render fieldLabel("comp-border-input", "Border")}
    <select
      id="comp-border-input"
      value={style.border}
      onchange={(e) =>
        onchange({ border: (e.target as HTMLSelectElement).value as BorderStyle })}
      class="select select-sm select-bordered w-full"
    >
      {#each BORDER_OPTIONS as option (option)}
        <option value={option}>
          {option.charAt(0).toUpperCase() + option.slice(1)}
        </option>
      {/each}
    </select>
  </div>

  <div class="form-control">
    {@render fieldLabel("comp-font-input", "Font")}
    <select
      id="comp-font-input"
      value={style.font}
      onchange={(e) => onchange({ font: (e.target as HTMLSelectElement).value })}
      class="select select-sm select-bordered w-full"
    >
      {#each FONT_OPTIONS as option (option)}
        <option value={option}>
          {option === DEFAULT_FONT
            ? "Unstyled"
            : option.charAt(0).toUpperCase() + option.slice(1)}
        </option>
      {/each}
    </select>
  </div>
</div>
