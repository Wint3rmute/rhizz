<script module lang="ts">
// Shared, app-wide daisyUI theme state. A module-only file (no markup),
// following the same pattern as ViewEditorState.svelte/KeyboardState.svelte
// \u2014 any component can import and read/toggle it without prop-drilling.
const STORAGE_KEY = "THEME";
type Theme = "light" | "dark";

function loadInitialTheme(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "dark";
}

let theme = $state<Theme>(loadInitialTheme());

if (typeof document !== "undefined") {
  // $effect.root creates an effect scope outside any component's
  // lifecycle, which is what lets a plain module (not a mounted
  // component) react to state changes. Keeps <html data-theme="..."> and
  // localStorage in sync with `theme`, including setting them once for
  // the initial value on load.
  $effect.root(() => {
    $effect(() => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(STORAGE_KEY, theme);
    });
  });
}

export function getTheme(): Theme {
  return theme;
}

export function toggleTheme() {
  theme = theme === "dark" ? "light" : "dark";
}
</script>
