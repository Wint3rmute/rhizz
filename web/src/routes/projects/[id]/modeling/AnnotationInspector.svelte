<script lang="ts">
import type { Annotation } from "../../../../rhizz_wasm_wrapper";
import { annotationSvgLines } from "./annotationMarkdown";

// Inspector panel for a single selected view annotation: multi-line text
// plus the font-scale number input. Text binds directly to the annotation
// (like the old pop-up editor did) so the canvas re-renders live while
// typing; the page records one undo point per edit session via
// `ontexteditstart` and persists on `ontextcommitted`.

/** Floor for the scale input, mirroring the corner-drag guard in +page.svelte. */
export const MIN_ANNOTATION_SCALE = 0.5;

interface Props {
  annotation: Annotation;
  /** Fired once per text edit session (first keystroke after focus). */
  ontexteditstart: () => void;
  /** Fired when text is committed (blur or Escape) so the diagram persists. */
  ontextcommitted: () => void;
  /** Fired with the validated scale committed from the number input. */
  onscalechange: (scale: number) => void;
}

let {
  annotation,
  ontexteditstart,
  ontextcommitted,
  onscalechange,
}: Props = $props();

let textarea: HTMLTextAreaElement | null = $state(null);
// True once the current focus session recorded its undo point.
let textArmed = false;

/** Focus the text editor with the caret at the end (double-click target). */
export function focusText(): void {
  textarea?.focus();
  if (textarea) {
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function handleTextFocus(): void {
  textArmed = false;
}

function handleTextInput(): void {
  if (!textArmed) {
    textArmed = true;
    ontexteditstart();
  }
}

function commitText(): void {
  textArmed = false;
  ontextcommitted();
}

// Draft scale text while the number input is being edited (null when idle).
// Display falls back to the annotation's scale, so external changes (e.g.
// the canvas corner-drag handle) show up immediately when not editing.
let scaleDraft: string | null = $state(null);
const displayScale = $derived(scaleDraft ?? String(annotation.scale ?? 1));

function handleScaleInput(e: Event): void {
  scaleDraft = (e.target as HTMLInputElement).value;
}

function commitScale(): void {
  const raw = scaleDraft;
  scaleDraft = null;
  if (raw === null) return;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return; // display falls back to the prop
  onscalechange(Math.max(MIN_ANNOTATION_SCALE, parsed));
}
</script>

<div class="space-y-4 text-sm" data-testid="annotation-inspector">
  <div>
    <div
      class="text-[11px] text-base-content/50 font-mono uppercase"
    >
      Annotation
    </div>
    <p class="text-xs text-base-content/50 mt-1">
      Free-standing canvas note (Markdown supported).
    </p>
  </div>

  <div class="form-control">
    <label class="label py-1" for="annotation-text-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Text
      </span>
    </label>
    <textarea
      id="annotation-text-input"
      bind:this={textarea}
      bind:value={annotation.text}
      onfocus={handleTextFocus}
      oninput={handleTextInput}
      onblur={commitText}
      onkeydown={(e) => {
        if (e.key === "Escape") textarea?.blur();
      }}
      class="textarea textarea-sm textarea-bordered w-full resize-y"
      rows={Math.max(2, annotationSvgLines(annotation.text).length)}
      placeholder="Markdown supported — Enter for a new line"
      title="Enter inserts a newline. Markdown: **bold**, *italic*, # heading, - list"
      data-testid="annotation-text-input"
    ></textarea>
  </div>

  <div class="form-control">
    <label class="label py-1" for="annotation-scale-input">
      <span
        class="label-text text-xs font-semibold uppercase tracking-wider text-base-content/70">
        Scale
      </span>
    </label>
    <input
      id="annotation-scale-input"
      type="number"
      min={MIN_ANNOTATION_SCALE}
      step="0.25"
      value={displayScale}
      oninput={handleScaleInput}
      onchange={commitScale}
      onblur={commitScale}
      class="input input-sm input-bordered w-full"
      data-testid="annotation-scale-input"
    />
  </div>
</div>
