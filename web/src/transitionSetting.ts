// Pure transition-duration setting logic — no DOM/localStorage access at
// module level, so it stays unit-testable in the pure-function vitest
// environment (see vite.config.ts). The Svelte wrapper
// (TransitionState.svelte.ts) owns all browser side effects and storage I/O.

export const TRANSITION_MS_STORAGE_KEY = "RHIZOME_TRANSITION_MS";
export const TRANSITION_MS_DEFAULT = 320;
export const TRANSITION_MS_MIN = 0;
export const TRANSITION_MS_MAX = 3000;

/** Clamp to [MIN, MAX] and round. Non-finite values fall back to default. */
export function clampTransitionMs(value: number): number {
  if (!Number.isFinite(value)) return TRANSITION_MS_DEFAULT;
  const rounded = Math.round(value);
  return Math.min(TRANSITION_MS_MAX, Math.max(TRANSITION_MS_MIN, rounded));
}

/**
 * Parse a raw localStorage value into a valid duration. Accepts both the
 * raw format ("500") and JSON-encoded values (`"500"`, `500`). Anything
 * unusable — missing, corrupt, or non-numeric — resolves to the default.
 */
export function parseTransitionMs(raw: string | null): number {
  if (raw === null) return TRANSITION_MS_DEFAULT;
  const trimmed = raw.trim();
  if (trimmed === "") return TRANSITION_MS_DEFAULT;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "number") return clampTransitionMs(parsed);
    if (typeof parsed === "string") {
      const num = Number(parsed.trim());
      if (Number.isFinite(num)) return clampTransitionMs(num);
    }
  } catch {
    // Not JSON — fall through to the plain-number parse below.
  }
  const num = Number(trimmed);
  if (Number.isFinite(num)) return clampTransitionMs(num);
  return TRANSITION_MS_DEFAULT;
}
