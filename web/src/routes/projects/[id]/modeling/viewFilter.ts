// The view `filter { include_tags = [...] }` coverage contract, as the
// Modeling sidebar presents it. rhizome-core owns the rule (W023 in
// `crates/rhizome-core/src/validate.rs`, documented in
// `SPEC/diagnostics/W023.md`); this module mirrors it on the editor's
// unsaved state so the "not shown" list updates the moment a node is placed,
// without waiting for the debounced save and recompile.
import {
  componentInSystem,
  type ComponentTreeComponent,
} from "./componentTree";

export interface FilterableComponent extends ComponentTreeComponent {
  tags: string[];
}

export interface MissingComponent {
  /** Structural persistence key (the `node` label it would be saved under). */
  key: string;
  label: string;
  /** The filter tags this component carries. */
  matchedTags: string[];
}

/**
 * Components of the view's system that carry one of `includeTags` but are not
 * placed on the canvas, sorted by key. An empty filter requires nothing.
 */
export function missingFilteredComponents(
  components: FilterableComponent[],
  componentKeys: string[],
  systemIndex: number,
  includeTags: readonly string[],
  placed: ReadonlySet<string>,
): MissingComponent[] {
  if (includeTags.length === 0 || systemIndex < 0) return [];
  const missing: MissingComponent[] = [];
  components.forEach((component, index) => {
    const key = componentKeys[index];
    if (key === undefined || placed.has(key)) return;
    const matchedTags = component.tags.filter((tag) =>
      includeTags.includes(tag),
    );
    if (matchedTags.length === 0) return;
    if (!componentInSystem(components, index, systemIndex)) return;
    missing.push({ key, label: component.label, matchedTags });
  });
  return missing.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Adds the tag typed into the chip input. Whitespace is trimmed (a tag can
 * never contain a space: space is what confirms a chip), and empty or
 * duplicate tags leave the list unchanged — the same array is returned so
 * callers can skip a no-op write.
 */
export function addFilterTag(tags: readonly string[], raw: string): string[] {
  const tag = raw.trim();
  if (tag === "" || /\s/.test(tag) || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

/** Removes one tag chip. */
export function removeFilterTag(
  tags: readonly string[],
  tag: string,
): string[] {
  return tags.filter((t) => t !== tag);
}
