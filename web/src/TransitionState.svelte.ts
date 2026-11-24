// Shared, app-wide "diagram transition duration" setting — a module-only
// file (no markup), following the same pattern as
// WarningLevelState.svelte.ts: any component can import and read/change it
// without prop-drilling.
//
// The duration is a global localStorage-backed key-value setting in
// milliseconds (0 = instant, 3000 = 3s). Validation lives in
// ./transitionSetting.ts: a stale or hand-edited localStorage entry falls
// back to the default instead of reaching the tween, which would produce
// NaN frames.
import { safeGetItem, safeSetItem } from "./safeStorage";
import {
  clampTransitionMs,
  parseTransitionMs,
  TRANSITION_MS_DEFAULT,
  TRANSITION_MS_MAX,
  TRANSITION_MS_MIN,
  TRANSITION_MS_STORAGE_KEY,
} from "./transitionSetting";

export {
  TRANSITION_MS_DEFAULT,
  TRANSITION_MS_MAX,
  TRANSITION_MS_MIN,
  TRANSITION_MS_STORAGE_KEY,
};

function readInitialTransitionMs(): number {
  return parseTransitionMs(safeGetItem(TRANSITION_MS_STORAGE_KEY));
}

let transitionMs = $state<number>(readInitialTransitionMs());

function persistTransitionMs(value: number): void {
  safeSetItem(TRANSITION_MS_STORAGE_KEY, JSON.stringify(value));
}

/** The active transition duration in ms; reactive to {@link setTransitionMs}. */
export function getTransitionMs(): number {
  return transitionMs;
}

/** Sets the transition duration, clamping to [MIN, MAX]. NaN falls back to default. */
export function setTransitionMs(value: number): void {
  const clamped = clampTransitionMs(value);
  transitionMs = clamped;
  persistTransitionMs(clamped);
}

/** Resets the transition duration to its default. */
export function resetTransitionMs(): void {
  setTransitionMs(TRANSITION_MS_DEFAULT);
}
