// Trailing-edge debouncing, framework-free: no Svelte runes, no timers owned
// by a component, just a plain function that can be created anywhere and
// driven from anywhere (including an `$effect` body).
//
// It exists for the app's two high-frequency VFS write sources — the code
// editor (one write per keystroke) and the Modeling canvas (one write per drag
// tick). Each of those persists the *whole* VFS blob, so a burst of edits used
// to turn into a burst of network round trips (and a burst of `vfs.size`
// samples in Sentry). Coalescing them into one trailing write fixes that at
// the source, rather than debouncing inside `VfsProjectStore.mutate()` — whose
// per-call rejection contract the debounced callers rely on.
//
// The call's arguments are captured at call time, not at run time, so the run
// always carries the newest state: with a snapshot object as an argument, the
// latest call's snapshot replaces the pending one.

/**
 * A debounced function: calling it schedules `fn`, and repeated calls
 * collapse into a single trailing run.
 */
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  /**
   * Runs the pending call now, if there is one, and disarms the timer.
   *
   * The safety valve for the two ways a trailing write could otherwise be
   * lost: the caller is about to stop caring about this target (switching the
   * open file/view, deleting or renaming it) or is going away entirely
   * (unmount/navigation). Flushing with nothing pending does nothing.
   */
  flush(): void;
  /** Whether a call is waiting on the timer. */
  readonly pending: boolean;
}

/**
 * Wraps `fn` so that it runs `delayMs` after the last call, with that last
 * call's arguments.
 */
export function createDebounced<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;

  function invoke(): void {
    const args = pendingArgs;
    pendingArgs = undefined;
    timer = undefined;
    if (args !== undefined) fn(...args);
  }

  function disarm(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  const debounced = (...args: Args): void => {
    pendingArgs = args;
    disarm();
    timer = setTimeout(invoke, delayMs);
  };

  debounced.flush = (): void => {
    disarm();
    invoke();
  };

  // `pending` is a getter, which TypeScript can't see through, hence the cast.
  Object.defineProperty(debounced, "pending", {
    get: () => pendingArgs !== undefined,
  });

  return debounced as Debounced<Args>;
}
