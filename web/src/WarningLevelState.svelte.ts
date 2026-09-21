// Shared, app-wide "warning level" setting — a module-only file (no markup),
// following the same pattern as ThemeState.svelte/KeyboardState.svelte: any
// component can import and read/change it without prop-drilling.
//
// The level is a project-wide preset (see SPEC/warning-levels.md) that gates
// which *warnings* the compiler reports; errors are never gated. It is
// persisted to localStorage so the choice survives a reload, using the same
// JSON-encoded single-value convention as ./Persisted.svelte: the setter
// writes synchronously (no `$effect` timing involved), and the initial read
// JSON-decodes with a fallback to the raw value, so both machine-written
// (`"business"`) and hand-edited (`business`) entries load.
//
// Validation lives here rather than in ./Persisted.svelte: a stale or
// hand-edited localStorage entry must never reach the compiler, which would
// reject it with a `JsError`.
import {
  DEFAULT_WARNING_LEVEL,
  WARNING_LEVELS,
  type WarningLevel,
} from "./rhizz_wasm_wrapper";

/** localStorage key holding the JSON-encoded warning level. */
export const WARNING_LEVEL_STORAGE_KEY = "RHIZZ_WARNING_LEVEL";

/** Narrows an arbitrary string to a known `WarningLevel`, or `null`. */
export function parseWarningLevel(value: string | null): WarningLevel | null {
  return WARNING_LEVELS.find((level) => level === value) ?? null;
}

/**
 * Display spellings for the level names. The stored value and the compiler
 * vocabulary are lowercase (matching the CLI's `--warning-level`), but the
 * navbar control reads better capitalised.
 */
const WARNING_LEVEL_LABELS: Record<WarningLevel, string> = {
  business: "Business",
  architectural: "Architectural",
  component: "Component",
};

/** Human-readable label for a level, for use in UI controls. */
export function warningLevelLabel(level: WarningLevel): string {
  return WARNING_LEVEL_LABELS[level];
}

function readInitialWarningLevel(): WarningLevel {
  if (typeof localStorage === "undefined") return DEFAULT_WARNING_LEVEL;
  const raw = localStorage.getItem(WARNING_LEVEL_STORAGE_KEY);
  if (raw === null) return DEFAULT_WARNING_LEVEL;
  // Machine-written entries are JSON-encoded; tolerate bare hand-edited
  // ones. Anything else (garbage, unknown names, wrong types) is corrupt.
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    decoded = raw;
  }
  return typeof decoded === "string"
    ? (parseWarningLevel(decoded) ?? DEFAULT_WARNING_LEVEL)
    : DEFAULT_WARNING_LEVEL;
}

let warningLevel = $state<WarningLevel>(readInitialWarningLevel());

function persistWarningLevel(level: WarningLevel): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(WARNING_LEVEL_STORAGE_KEY, JSON.stringify(level));
}

/** The active warning level; reactive to {@link setWarningLevel}. */
export function getWarningLevel(): WarningLevel {
  return warningLevel;
}

/** Sets the warning level, persisting it. Unknown values are ignored, never thrown. */
export function setWarningLevel(value: string): void {
  const parsed = parseWarningLevel(value);
  if (parsed === null) return;
  warningLevel = parsed;
  persistWarningLevel(parsed);
}
