// A generic, bounded undo/redo stack. Deliberately has zero dependency on
// any diagram-specific type (`T` is opaque to this module), so it can be
// unit tested directly (see history.test.ts) with plain values, and
// reused for any snapshot-able piece of state that wants undo/redo — not
// just the diagram layout.
export type HistoryStack<T> = {
  undoStack: T[];
  redoStack: T[];
};

export function createHistoryStack<T>(): HistoryStack<T> {
  return { undoStack: [], redoStack: [] };
}

// Caps `stack`'s length at `limit`, discarding from the *front* (the
// oldest entries) — the stack's end is always the most recent entry, so
// this keeps the most recent `limit` entries.
function capAtLimit<T>(stack: T[], limit: number): void {
  while (stack.length > limit) stack.shift();
}

// Records `snapshot` as a new undo point. Any existing redo history is
// discarded — once a new edit happens, the old "future" (what redo would
// have restored) is no longer reachable, matching how undo/redo works in
// essentially every editor.
export function pushHistory<T>(
  stack: HistoryStack<T>,
  snapshot: T,
  limit: number,
): void {
  stack.undoStack.push(snapshot);
  capAtLimit(stack.undoStack, limit);
  stack.redoStack.length = 0;
}

// Steps one entry back in history: `current` (the state right before
// undoing) is pushed onto the redo stack so a subsequent redo can restore
// it, and the most recent undo entry is popped and returned. Returns
// `null` (leaving both stacks untouched) if there's nothing to undo.
export function undoHistory<T>(
  stack: HistoryStack<T>,
  current: T,
  limit: number,
): T | null {
  const previous = stack.undoStack.pop();
  if (previous === undefined) return null;
  stack.redoStack.push(current);
  capAtLimit(stack.redoStack, limit);
  return previous;
}

// The mirror image of undoHistory: steps one entry forward, pushing
// `current` back onto the undo stack. Returns `null` if there's nothing
// to redo.
export function redoHistory<T>(
  stack: HistoryStack<T>,
  current: T,
  limit: number,
): T | null {
  const next = stack.redoStack.pop();
  if (next === undefined) return null;
  stack.undoStack.push(current);
  capAtLimit(stack.undoStack, limit);
  return next;
}
