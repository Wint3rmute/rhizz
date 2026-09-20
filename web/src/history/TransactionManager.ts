// Centralized undo/redo for UI-driven mutations.
//
// Today `Ctrl+Z` only reverts the layout-only snapshot in
// `routes/projects/[id]/modeling/history.ts`; model writes through
// `applyModelMutation` have no `undo()` — so add/remove leaves
// `system.hcl` behind. This manager consolidates both domains: each action
// encapsulates bidirectional execution (`do()` / `undo()`), covering the
// primary HCL write *and* the corresponding `views.hcl` layout write.
//
// There is no second TypeScript model on the write path — transactions go
// through the single entry point `applyModelMutation` (Rust-owned
// `apply_model_op` via WASM) plus a layout mutator, never a second
// dispatcher.
//
// Snapshot-pair is preferred over hand-written inverses: undoing a create
// must remove exactly what the dispatcher created (container fallback,
// definition+instance creation, instance-under-instance redirection, LCA
// scope resolution), which snapshots get for free.

export interface Transaction {
  label: string;
  /** Runs the action. Return `false` to refuse (nothing is pushed). */
  do(): Promise<boolean> | boolean;
  /** Restores the pre-`do()` state. Only called after a `true` `do()`. */
  undo(): Promise<void> | void;
}

export class TransactionManager {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Executes `tx`, pushing it for undo on success. Clears redo. */
  async execute(tx: Transaction): Promise<boolean> {
    const applied = await tx.do();
    if (!applied) return false;
    this.undoStack.push(tx);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  /** Steps one entry back. Returns `false` when there is nothing to undo. */
  async undo(): Promise<boolean> {
    const tx = this.undoStack.pop();
    if (!tx) return false;
    await tx.undo();
    this.redoStack.push(tx);
    while (this.redoStack.length > this.limit) this.redoStack.shift();
    return true;
  }

  /** Steps one entry forward. Returns `false` when there is nothing to redo. */
  async redo(): Promise<boolean> {
    const tx = this.redoStack.pop();
    if (!tx) return false;
    const applied = await tx.do();
    if (!applied) {
      // A redo that refuses leaves the stacks untouched apart from the
      // pop — push it back so a later retry can still succeed.
      this.redoStack.push(tx);
      return false;
    }
    this.undoStack.push(tx);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

/**
 * Builds a snapshot-pair transaction over opaque state.
 *
 * Captures `before` lazily on `do()` (so the transaction can be constructed
 * before the mutation runs), runs `apply()`, captures `after`, and restores
 * via `restore()`. `apply()` returning `false` refuses the transaction —
 * nothing is pushed and `restore()` is never called.
 */
export function snapshotTransaction<T>(options: {
  label: string;
  snapshot: () => Promise<T> | T;
  apply: () => Promise<boolean> | boolean;
  restore: (snapshot: T) => Promise<void> | void;
  isEqual?: (a: T, b: T) => boolean;
}): Transaction {
  let before: T | undefined;
  let after: T | undefined;
  return {
    label: options.label,
    async do(): Promise<boolean> {
      // Redo re-runs `apply()` against the restored `before` state; the
      // first run captures `before`, later runs re-capture an equal one.
      before = await options.snapshot();
      const applied = await options.apply();
      if (!applied) {
        before = undefined;
        return false;
      }
      after = await options.snapshot();
      if (
        before !== undefined &&
        after !== undefined &&
        options.isEqual?.(before, after) === true
      ) {
        // No-op: don't pollute history with an undo point that changes
        // nothing (e.g. a redundant alignment write).
        before = undefined;
        after = undefined;
        return false;
      }
      return true;
    },
    async undo(): Promise<void> {
      if (before === undefined) return;
      await options.restore(before);
      // Keep `after` for redo: redo re-runs `apply()` rather than
      // restoring `after`, so layout writes stay canonical.
      void after;
    },
  };
}
