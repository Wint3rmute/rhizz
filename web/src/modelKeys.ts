// Helpers around rhizz-core's structurally-stable component keys
// (`Model::component_keys`): a label path per component, index-aligned with
// `model.components()`, which — unlike an arena index — only changes when the
// component (or an ancestor) is renamed or reparented. Every view that maps
// persisted layout entries back onto the compiled model needs the same two
// lookups, so they live here once.
import type { ModelJS } from "rhizz";

/** Fallback key for an index the model didn't supply one for. */
export function fallbackComponentKey(index: number): string {
  return `#${String(index)}`;
}

/** The stable key for `components[index]`. */
export function componentKeyAt(keys: string[], index: number): string {
  return keys[index] ?? fallbackComponentKey(index);
}

/**
 * Reverse lookup from a component key back to its arena index, rebuilt from
 * the compiled model. Keys absent from the result belong to components that
 * no longer exist (renamed, removed, or reparented).
 */
export function componentKeyIndex(
  model: ModelJS | undefined,
): Map<string, number> {
  const map = new Map<string, number>();
  (model?.component_keys() ?? []).forEach((key, index) => map.set(key, index));
  return map;
}
