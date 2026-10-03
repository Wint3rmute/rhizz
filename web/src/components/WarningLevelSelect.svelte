<script lang="ts">
import {
  getWarningLevel,
  setWarningLevel,
  warningLevelLabel,
} from "../WarningLevelState.svelte";
import { WARNING_LEVELS } from "../rhizz_wasm_wrapper";

// The project-wide warning preset: it gates which warnings the compiler
// reports (errors are never gated) and persists across reloads.
//
// This lived in the navbar, rendered twice — once in the desktop row, once in
// the mobile menu — with the two copies kept in step by hand and given
// different element ids. It is one value with one meaning, so it is one
// component now, living in the diagnostics bar.
//
// It reads and writes the shared singleton instead of taking props: every
// surface that shows the level shows the same one, so there is nothing for a
// caller to pass. The one thing it does hard-code is the element id — a second
// instance would need its own, and there is only one.
let warningLevel = $derived(getWarningLevel());
</script>

<!-- The visible label is `sr-only` at every width. It used to appear from `lg`
     up in the navbar, which was already tight at `md`; the bar is a status
     strip, and the level's own name ("Component") carries the meaning in one
     word. The `title` spells out what the control gates for anyone hovering
     it or reaching it by keyboard. -->
<label for="warning-level" class="sr-only">Strictness</label>
<select
  id="warning-level"
  class="select select-xs text-xs w-auto shrink-0 max-w-24 sm:max-w-none"
  title="How much detail this project is specified at — gates which warnings are reported. Errors are always reported."
  value={warningLevel}
  onchange={(event) => setWarningLevel(event.currentTarget.value)}
>
  <!-- The list carries a group heading, so opening the control says what the
       numbers mean instead of leaving three bare words. `<optgroup>` is the
       honest way to do that: it is a real, non-selectable heading the browser
       draws, and assistive technology announces the group with the option.
       daisyUI has nothing for it — it styles `option` (padding, radius, hover)
       and the popup, but has no `optgroup` rules, so the heading is drawn by
       the browser. The alternative, a disabled first `<option>`, would have
       inherited daisyUI's option styling and read as a fourth level. -->
  <optgroup label="Strictness level">
    {#each WARNING_LEVELS as level (level)}
      <option value={level}>{warningLevelLabel(level)}</option>
    {/each}
  </optgroup>
</select>
