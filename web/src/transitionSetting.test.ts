import { describe, expect, it } from "vitest";
import {
  clampTransitionMs,
  parseTransitionMs,
  TRANSITION_MS_DEFAULT,
  TRANSITION_MS_MAX,
  TRANSITION_MS_MIN,
} from "./transitionSetting";

describe("parseTransitionMs", () => {
  it("defaults when nothing is stored", () => {
    expect(parseTransitionMs(null)).toBe(TRANSITION_MS_DEFAULT);
  });

  it("accepts plain and JSON-encoded numbers", () => {
    expect(parseTransitionMs("500")).toBe(500);
    expect(parseTransitionMs(JSON.stringify(1200))).toBe(1200);
    expect(parseTransitionMs("  0  ")).toBe(0);
    expect(parseTransitionMs("3000")).toBe(3000);
  });

  it("clamps out-of-range values", () => {
    expect(parseTransitionMs("-50")).toBe(TRANSITION_MS_MIN);
    expect(parseTransitionMs("9999")).toBe(TRANSITION_MS_MAX);
  });

  it("falls back to default on corrupt values", () => {
    expect(parseTransitionMs("{oops")).toBe(TRANSITION_MS_DEFAULT);
    expect(parseTransitionMs("")).toBe(TRANSITION_MS_DEFAULT);
    expect(parseTransitionMs("fast")).toBe(TRANSITION_MS_DEFAULT);
    expect(parseTransitionMs(JSON.stringify("fast"))).toBe(
      TRANSITION_MS_DEFAULT,
    );
  });
});

describe("clampTransitionMs", () => {
  it("clamps and rounds to an integer", () => {
    expect(clampTransitionMs(320.6)).toBe(321);
    expect(clampTransitionMs(-1)).toBe(TRANSITION_MS_MIN);
    expect(clampTransitionMs(5000)).toBe(TRANSITION_MS_MAX);
  });

  it("falls back to default for non-finite values", () => {
    expect(clampTransitionMs(NaN)).toBe(TRANSITION_MS_DEFAULT);
    expect(clampTransitionMs(Infinity)).toBe(TRANSITION_MS_DEFAULT);
  });
});
