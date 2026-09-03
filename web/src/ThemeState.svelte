<script module lang="ts">
// Shared, app-wide daisyUI theme state. A module-only file (no markup),
// following the same pattern as ViewEditorState.svelte/KeyboardState.svelte
// \u2014 any component can import and read/toggle it without prop-drilling.
//
// Two levels of state:
//   - `selection` ("auto" | "light" | "dark") is what the user has chosen;
//     "auto" (the default) means "follow the browser's preference". Only a
//     manual interaction pins a concrete value.
//   - `resolved` ("light" | "dark") is what is actually applied to the
//     page; daisyUI never sees "auto" in <html data-theme>.
//
// The pure logic lives in ./theme.ts so it can be unit-tested without a
// DOM; this module owns the browser side effects (matchMedia, <html
// data-theme>, localStorage) only.

import {
  loadSelection,
  nextSelectionOnToggle,
  type ResolvedTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeSelection,
} from "./theme";

function readInitialSelection(): ThemeSelection {
  if (typeof localStorage === "undefined") return "auto";
  return loadSelection(localStorage.getItem(THEME_STORAGE_KEY));
}

function systemPrefersDark(): boolean {
  if (
    typeof window === "undefined" || typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

let selection = $state<ThemeSelection>(readInitialSelection());
// Tracked separately (not read from matchMedia inside a derived) so the
// media-query "change" listener can push updates into the reactive graph.
let prefersDark = $state<boolean>(systemPrefersDark());

function resolve(): ResolvedTheme {
  return resolveTheme(selection, prefersDark);
}

if (typeof window !== "undefined") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", (event) => {
    prefersDark = event.matches;
  });

  // $effect.root creates an effect scope outside any component's
  // lifecycle, which is what lets a plain module (not a mounted
  // component) react to state changes. Keeps <html data-theme="..."> and
  // localStorage in sync with `selection`/`prefersDark`, including
  // setting them once for the initial value on load.
  $effect.root(() => {
    $effect(() => {
      document.documentElement.dataset.theme = resolve();
      localStorage.setItem(THEME_STORAGE_KEY, selection);
    });
  });
}

/** The theme currently applied to the page ("light" | "dark"). */
export function getTheme(): ResolvedTheme {
  return resolve();
}

/** The user's selection ("auto" | "light" | "dark"). */
export function getSelection(): ThemeSelection {
  return selection;
}

/** Explicitly pin (or unpin to auto) the theme selection. */
export function setSelection(next: ThemeSelection) {
  selection = next;
}

/** Toggle light/dark — always pins an explicit value (leaves auto). */
export function toggleTheme() {
  selection = nextSelectionOnToggle(resolve());
}
</script>
