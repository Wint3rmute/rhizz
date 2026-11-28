import { describe, expect, it } from "vitest";
import { portNameProblem } from "./portName";

describe("portNameProblem", () => {
  const labels = ["link-thinkcentre", "wifi"];
  it("accepts a fresh name and the port's own name", () => {
    expect(portNameProblem("eth", labels, 0)).toBeUndefined();
    expect(portNameProblem(" link-thinkcentre ", labels, 0)).toBeUndefined();
  });
  it("refuses empty, slashed and taken names", () => {
    expect(portNameProblem("  ", labels, 0)).toBe(
      "A port name cannot be empty.",
    );
    expect(portNameProblem("a/b", labels, 0)).toBe(
      "A port name cannot contain “/”.",
    );
    expect(portNameProblem("wifi", labels, 0)).toBe(
      "A port named “wifi” already exists.",
    );
  });
});
