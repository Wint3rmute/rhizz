// Pure theme logic — no DOM/localStorage access at module level, so it
// stays unit-testable in the pure-function vitest environment (see the
// comment in vite.config.ts). The Svelte wrapper (ThemeState.svelte) owns
// all browser side effects and storage I/O.
//
// A theme has two distinct concepts:
//   - selection: what the user has chosen — "auto" (follow the browser),
//     or an explicit pin to "light"/"dark". This is what gets persisted.
//   - resolved: the concrete theme actually applied to the page
//     ("light"/"dark"). daisyUI never sees "auto" in <html data-theme>.

export type ThemeSelection = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "THEME";

export function isThemeSelection(value: unknown): value is ThemeSelection {
  return value === "auto" || value === "light" || value === "dark";
}

/**
 * Parse a raw localStorage value into a valid selection. Accepts both the
 * legacy raw format ("dark") and JSON-encoded values (`"dark"`, in case
 * older code wrote through JSON.stringify). Anything unusable — missing,
 * corrupt, or an unknown value — resolves to "auto", which is the new
 * startup default per the "respect the browser's theme" task.
 */
export function loadSelection(raw: string | null): ThemeSelection {
  if (raw === null) return "auto";
  const trimmed = raw.trim();
  if (isThemeSelection(trimmed)) return trimmed;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isThemeSelection(parsed) ? parsed : "auto";
  } catch {
    return "auto";
  }
}

/** Map a selection + OS preference to the theme applied on the page. */
export function resolveTheme(
  selection: ThemeSelection,
  prefersDark: boolean,
): ResolvedTheme {
  if (selection !== "auto") return selection;
  return prefersDark ? "dark" : "light";
}

/**
 * Toggling always *pins* the theme to the opposite of what is currently
 * applied — switching away from auto is what makes the choice explicit.
 */
export function nextSelectionOnToggle(resolved: ResolvedTheme): ThemeSelection {
  return resolved === "dark" ? "light" : "dark";
}
