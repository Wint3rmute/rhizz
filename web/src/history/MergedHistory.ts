// One undo/redo for two kinds of edit.
//
// The modeling canvas has two domains that must interleave in a single
// Ctrl+Z timeline:
//
//   - **layout** edits (drag, resize, marquee) are pure state: a snapshot of
//     `checked` / `savedLayout` / `savedConnections` / `annotations` that gets
//     restored wholesale.
//   - **model** edits (create, rename, connect, …) are `Transaction`s from
//     `TransactionManager`, each owning its own `do()` / `undo()`.
//
// They used to live in two stacks with four parallel sequence arrays so that
// a drag following a create undoes the drag first. That merge policy is real
// and worth keeping, but the bookkeeping belongs here rather than in the
// page, which ended up with four near-identical entry functions and four
// hand-trimmed arrays to support it.
//
// Each domain keeps its own redo stack. That is deliberate and load-bearing:
// a layout edit does not discard a pending model redo, and vice versa, so
// interleaved edits can each be redone independently.

import { type Transaction, TransactionManager } from "./TransactionManager";

export interface LayoutAdapter<T> {
  /** Captures the current layout state. */
  snapshot(): T;
  /** Restores a previously captured state. */
  apply(snapshot: T): void;
}

export interface MergedHistoryOptions<T> {
  layout: LayoutAdapter<T>;
  /** Maximum retained entries *per domain*. */
  limit?: number;
}

export class MergedHistory<T> {
  readonly models: TransactionManager;

  private readonly layout: LayoutAdapter<T>;
  private readonly limit: number;

  private layoutUndo: T[] = [];
  private layoutRedo: T[] = [];
  /**
   * Sequence number per retained entry, parallel to the arrays above. The
   * number is the entry's original position in the interleaved timeline, so
   * an entry that moves between the undo and redo stacks keeps its rank.
   */
  private layoutUndoSeq: number[] = [];
  private layoutRedoSeq: number[] = [];
  private modelUndoSeq: number[] = [];
  private modelRedoSeq: number[] = [];

  /** Monotonic across both domains — this is what orders the interleaving. */
  private seq = 0;

  constructor(options: MergedHistoryOptions<T>) {
    this.layout = options.layout;
    this.limit = options.limit ?? 100;
    this.models = new TransactionManager(this.limit);
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /** Records the layout as an undo point. Call once per *gesture*. */
  recordLayoutPoint(): void {
    this.layoutUndo.push(this.layout.snapshot());
    this.layoutUndoSeq.push(++this.seq);
    this.cap(this.layoutUndo, this.layoutUndoSeq);
    // A new layout edit invalidates the layout "future" only.
    this.layoutRedo.length = 0;
    this.layoutRedoSeq.length = 0;
  }

  /** Runs a model transaction, pushing it on success. Clears model redo. */
  async runModelTransaction(tx: Transaction): Promise<boolean> {
    const applied = await this.models.execute(tx);
    if (applied) {
      this.modelUndoSeq.push(++this.seq);
      this.capSeq(this.modelUndoSeq);
      this.modelRedoSeq.length = 0;
    }
    return applied;
  }

  // ── Stepping ─────────────────────────────────────────────────────────────

  /**
   * Steps back one entry: the newest across both domains.
   *
   * "Newest" is the highest sequence number — the drag that happened after the
   * create is the one the user just did, so it is the one they want to take
   * back first.
   */
  async undo(): Promise<boolean> {
    if (this.newestModelUndo() > this.newestLayoutUndo()) {
      return this.undoModel();
    }
    if (this.layoutUndoSeq.length > 0) return this.undoLayout();
    return this.undoModel();
  }

  /**
   * Steps forward one entry: the *oldest* across both domains.
   *
   * Deliberately the mirror of {@link undo} rather than the same comparison:
   * redo replays the timeline forwards, so after undoing a create and then a
   * drag, redo must re-apply the create first. Picking the highest sequence
   * here would replay them in reverse. Each entry keeps its original sequence
   * number as it moves between the two stacks, which is what makes this
   * ordering well-defined.
   */
  async redo(): Promise<boolean> {
    if (this.oldestModelRedo() < this.oldestLayoutRedo()) {
      return this.redoModel();
    }
    if (this.layoutRedoSeq.length > 0) return this.redoLayout();
    return this.redoModel();
  }

  private async undoModel(): Promise<boolean> {
    if (!(await this.models.undo())) return false;
    const seq = this.modelUndoSeq.pop();
    if (seq !== undefined) {
      this.modelRedoSeq.push(seq);
      this.capSeq(this.modelRedoSeq);
    }
    return true;
  }

  private async redoModel(): Promise<boolean> {
    if (!(await this.models.redo())) return false;
    const seq = this.modelRedoSeq.pop();
    if (seq !== undefined) {
      this.modelUndoSeq.push(seq);
      this.capSeq(this.modelUndoSeq);
    }
    return true;
  }

  private undoLayout(): boolean {
    const previous = this.layoutUndo.pop();
    const seq = this.layoutUndoSeq.pop();
    if (previous === undefined || seq === undefined) return false;
    // Whatever is on the canvas right now is what a redo will restore.
    this.layoutRedo.push(this.layout.snapshot());
    this.layoutRedoSeq.push(seq);
    this.layout.apply(previous);
    return true;
  }

  private redoLayout(): boolean {
    const next = this.layoutRedo.pop();
    const seq = this.layoutRedoSeq.pop();
    if (next === undefined || seq === undefined) return false;
    this.layoutUndo.push(this.layout.snapshot());
    this.layoutUndoSeq.push(seq);
    this.layout.apply(next);
    return true;
  }

  // ── Introspection ────────────────────────────────────────────────────────

  /** Sequence of the newest retained entry; 0 means the domain is empty. */
  private newestLayoutUndo(): number {
    return this.layoutUndoSeq.at(-1) ?? 0;
  }

  private newestModelUndo(): number {
    return this.modelUndoSeq.at(-1) ?? 0;
  }

  /**
   * Sequence of the entry undone longest, or `Infinity` when the domain is
   * empty. The first entry pushed onto a redo stack is the one that was undone
   * *first*, so the replay head is index 0, not the end.
   */
  private oldestLayoutRedo(): number {
    return this.layoutRedoSeq[0] ?? Infinity;
  }

  private oldestModelRedo(): number {
    return this.modelRedoSeq[0] ?? Infinity;
  }

  /** Drops the oldest entries once a domain exceeds the limit. */
  private cap(entries: unknown[], seqs: number[]): void {
    while (entries.length > this.limit) {
      entries.shift();
      if (seqs.length > 0) seqs.shift();
    }
  }

  /** Same, for a domain whose entries live inside `TransactionManager`. */
  private capSeq(seqs: number[]): void {
    while (seqs.length > this.limit) seqs.shift();
  }
}
