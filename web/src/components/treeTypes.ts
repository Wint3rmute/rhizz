// Shared shape for ordered, nested tree data that the reusable
// `Tree.svelte` shell renders. Decoupled from any particular source
// (filesystem entries, component hierarchies, …): implementations build a
// `TreeNode[]` from their own flat data and hand it to the shell, which
// owns the collapse/indent/selection chrome.

/**
 * A single node in a tree. `children` is already nested; the shell only
 * ever recurses down it. `isExpandable` controls whether the row gets an
 * expand/collapse toggle (a directory, a non-leaf component), independent
 * of whether it happens to have children right now.
 */
export interface TreeNode {
  /** Stable unique id used for collapse tracking and selection. Must be
   *  unique across the whole tree, not just among siblings. */
  id: string;
  /** Display label. */
  name: string;
  /** Whether the row shows an expand/collapse toggle. */
  isExpandable: boolean;
  children: TreeNode[];
}
