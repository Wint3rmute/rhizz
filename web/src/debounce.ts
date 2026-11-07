// Debouncing, framework-free: no Svelte runes, no timers owned by a
// component, just a plain function that can be created anywhere and driven
// from anywhere (including an `$effect` body).
//
// It exists for the app's high-frequency VFS write sources — the code editor
// (one write per keystroke), the Modeling canvas (one write per drag tick),
// and the Inventory doc editor. Each of those persists the *whole* VFS blob,
// so a burst of edits used to turn into a burst of network round trips (and a
// burst of `vfs.size` samples in Sentry). Coalescing them into one trailing
// write fixes that at the source, rather than debouncing inside
// `VfsProjectStore.mutate()` — whose per-call rejection contract the debounced
// callers rely on.
//
// Pass `{ leading: true }` and the first call of an idle burst also runs
// immediately (used by the page-level VFS writers so the very first edit
// uploads at once and locks the project); later calls still collapse into
// one trailing run.
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
  /**
   * Drops the pending call without running it. For a follower tab that just
   * learned the server moved on: the queued write was composed against the
   * old state, and flushing it would silently clobber the remote change.
   */
  cancel(): void;
  /** Whether a call is waiting on the timer. */
  readonly pending: boolean;
}

/**
 * Wraps `fn` so that it runs `delayMs` after the last call, with that last
 * call's arguments.
 *
 * With `{ leading: true }`, the first call of an idle burst runs immediately
 * (locking the project on the very first keystroke instead of one debounce
 * window later) and only the *rest* of the burst collapses into one trailing
 * run. `flush`/`cancel`/`pending` keep their trailing meanings: `pending` is
 * true only while a trailing run is armed, and `cancel` also ends the
 * leading cooldown so the next call leads again.
 */
export function createDebounced<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
  opts?: { leading?: boolean },
): Debounced<Args> {
  const leading = opts?.leading === true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Args | undefined;
  let cooling = false;

  function invoke(): void {
    const args = pendingArgs;
    pendingArgs = undefined;
    timer = undefined;
    cooling = false;
    if (args !== undefined) fn(...args);
  }

  function disarm(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  const debounced = (...args: Args): void => {
    if (leading && !cooling && timer === undefined) {
      cooling = true;
      fn(...args);
      // Cooldown window: further calls collapse into one trailing run, and
      // a lone leading call schedules nothing for itself.
      timer = setTimeout(() => {
        timer = undefined;
        cooling = false;
        invoke();
      }, delayMs);
      return;
    }
    pendingArgs = args;
    disarm();
    timer = setTimeout(invoke, delayMs);
  };

  debounced.flush = (): void => {
    disarm();
    invoke();
  };

  debounced.cancel = (): void => {
    disarm();
    pendingArgs = undefined;
    cooling = false;
  };

  // `pending` is a getter, which TypeScript can't see through, hence the cast.
  Object.defineProperty(debounced, "pending", {
    get: () => pendingArgs !== undefined,
  });

  return debounced as Debounced<Args>;
}
