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
  /** One attribute changed. Merged into the component by the caller. */
  onchange: (patch: StylePatch) => void;
}

let { style, onchange }: Props = $props();

/** What the shared block is allowed to patch — the four above, nothing else. */
export type StylePatch = {
  full_name?: string;
  icon?: string | undefined;
  color?: ComponentColor;
  border?: BorderStyle;
  font?: string;
};

// The full name is a textarea committed on blur, so the draft is local: a
// half-typed name must not rewrite the model on every keystroke, and an
// abandoned edit must revert rather than persist. Resynced from the model
// whenever it changes underneath (an undo, or a different node selected).
let draftFullName = $state("");
$effect(() => {
  draftFullName = style.full_name ?? "";
});

function commitFullName() {
  if (draftFullName !== (style.full_name ?? "")) {
    onchange({ full_name: draftFullName });
  }
}
</script>

<div class="space-y-2" data-testid="component-style-fields">
  <div class="form-control">
    <label class="label py-1" for="comp-fullname-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Full name
      </span>
    </label>
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
    <label class="label py-1" for="comp-color-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Color
      </span>
    </label>
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
    <label class="label py-1" for="comp-border-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Border
      </span>
    </label>
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
    <label class="label py-1" for="comp-font-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Font
      </span>
    </label>
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