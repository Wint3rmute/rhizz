import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ToastLevel, ToastState } from "./ToastState.svelte";

describe("ToastState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["info", "warning", "error", "success"] satisfies ToastLevel[])(
    "adds a %s toast",
    (level) => {
      const state = new ToastState();

      const id = state.show("Something happened", level);

      expect(state.toasts).toEqual([
        { id, message: "Something happened", level },
      ]);
    },
  );

  it("automatically dismisses a toast after its timeout", () => {
    const state = new ToastState();
    state.show("Temporary", "info", 2_000);

    vi.advanceTimersByTime(1_999);
    expect(state.toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(state.toasts).toHaveLength(0);
  });

  it("dismisses a toast explicitly and cancels its timeout", () => {
    const state = new ToastState();
    const id = state.show("Dismiss me", "warning", 2_000);

    state.dismiss(id);
    expect(state.toasts).toHaveLength(0);

    vi.advanceTimersByTime(2_000);
    expect(state.toasts).toHaveLength(0);
  });

  it("uses the default timeout when none is provided", () => {
    const state = new ToastState();
    state.show("Default timeout");

    vi.advanceTimersByTime(4_999);
    expect(state.toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(state.toasts).toHaveLength(0);
  });
});
