import { describe, expect, it } from "vitest";
import {
  getTransitionMs,
  resetTransitionMs,
  setTransitionMs,
} from "./TransitionState.svelte";
import { TRANSITION_MS_DEFAULT } from "./transitionSetting";

describe("TransitionState", () => {
  it("defaults to the standard tween length", () => {
    resetTransitionMs();
    expect(getTransitionMs()).toBe(TRANSITION_MS_DEFAULT);
  });

  it("round-trips through the setter and clamps out-of-range values", () => {
    setTransitionMs(1200);
    expect(getTransitionMs()).toBe(1200);

    setTransitionMs(9999);
    expect(getTransitionMs()).toBe(3000);

    setTransitionMs(-5);
    expect(getTransitionMs()).toBe(0);

    resetTransitionMs();
    expect(getTransitionMs()).toBe(TRANSITION_MS_DEFAULT);
  });
});
