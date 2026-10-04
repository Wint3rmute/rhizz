import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounced } from "./debounce";

// Trailing-edge debouncing, as the two VFS write sources use it: a burst of
// calls (keystrokes, drag ticks) collapses into one run of the wrapped
// function, carrying the *last* call's arguments — the newest state is the
// only one worth writing.
describe("createDebounced", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the delay before running the wrapped function", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    debounced("first");
    expect(fn).not.toHaveBeenCalled();
    expect(debounced.pending).toBe(true);

    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith("first");
    expect(debounced.pending).toBe(false);
  });

  it("collapses a burst into a single call with the latest arguments", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    for (const text of ["a", "ab", "abc"]) {
      debounced(text);
      vi.advanceTimersByTime(100);
    }
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledExactlyOnceWith("abc");
  });

  it("restarts the delay on every call, so a continuous burst keeps waiting", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    // 10 calls, 100ms apart: the delay never elapses between two of them, so
    // none of them may run — a fixed window would have fired by now.
    for (let i = 0; i < 10; i++) {
      debounced(i);
      vi.advanceTimersByTime(100);
    }
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("flushes the pending call immediately, with its latest arguments", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    debounced("a", 1);
    vi.advanceTimersByTime(100);
    debounced("b", 2);

    debounced.flush();

    expect(fn).toHaveBeenCalledExactlyOnceWith("b", 2);
    expect(debounced.pending).toBe(false);
  });

  it("does not run the flushed call a second time when the timer would have fired", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    debounced("a");
    debounced.flush();
    vi.advanceTimersByTime(5_000);

    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("flushes nothing when no call is waiting", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    debounced("a");
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced.flush();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(debounced.pending).toBe(false);
  });

  it("stays debounced after a flush, so the next burst coalesces again", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 500);

    debounced("a");
    debounced.flush();
    debounced("b");

    vi.advanceTimersByTime(499);
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("keeps working with a zero delay", () => {
    const fn = vi.fn();
    const debounced = createDebounced(fn, 0);

    debounced("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledExactlyOnceWith("a");
  });
});
