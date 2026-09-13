import type { DocumentStore } from "../DocumentStore.svelte";

/**
 * Resolves where a new child instance should be *stored* for a given canvas
 * parent path. Children of an *instance* persist in that instance's
 * definition body: an `instance` block carries only `source` (E012), so
 * nesting under the instance itself would be silently dropped on write,
 * while `component` bodies may hold `instance` children (SPEC.md §2.3) that
 * the resolver clones into every instance. System and definition parents
 * are returned unchanged.
 */
export function resolveInstanceStoreParent(
  doc: DocumentStore,
  parentKey: string,
): string {
  const container = doc.findContainer(parentKey);
  return container?.parentComp?.source ?? parentKey;
}
