import { describe, expect, it } from "vitest";
import {
  getWarningLevel,
  parseWarningLevel,
  setWarningLevel,
} from "./WarningLevelState.svelte";

describe("WarningLevelState", () => {
  it("parses exactly the three known levels", () => {
    expect(parseWarningLevel("business")).toBe("business");
    expect(parseWarningLevel("architectural")).toBe("architectural");
    expect(parseWarningLevel("component")).toBe("component");
  });

  it("rejects anything else, including null", () => {
    expect(parseWarningLevel(null)).toBeNull();
    expect(parseWarningLevel("")).toBeNull();
    expect(parseWarningLevel("verbose")).toBeNull();
    // The compiler's own parser is case-insensitive, but the UI only ever
    // produces the canonical lowercase spellings — a stray casing in
    // localStorage is treated as corrupt rather than silently accepted.
    expect(parseWarningLevel("Business")).toBeNull();
  });

  it("defaults to the most detailed level", () => {
    expect(getWarningLevel()).toBe("component");
  });

  it("round-trips through the setter and ignores unknown values", () => {
    setWarningLevel("business");
    expect(getWarningLevel()).toBe("business");

    setWarningLevel("not-a-level");
    expect(getWarningLevel()).toBe("business");

    setWarningLevel("architectural");
    expect(getWarningLevel()).toBe("architectural");

    setWarningLevel("component");
    expect(getWarningLevel()).toBe("component");
  });
});
