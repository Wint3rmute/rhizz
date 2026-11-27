import { describe, expect, it } from "vitest";
import { portRowState, togglePortVisibility } from "./portVisibility";

describe("togglePortVisibility", () => {
  it("shows a port, keeping labels sorted", () => {
    expect(togglePortVisibility({ a: ["z"] }, "a", "m")).toEqual({
      a: ["m", "z"],
    });
  });

  it("hides a shown port and drops components left empty", () => {
    expect(togglePortVisibility({ a: ["p"], b: ["q"] }, "a", "p")).toEqual({
      b: ["q"],
    });
  });

  it("never mutates its input", () => {
    const input = { a: ["p"] };
    togglePortVisibility(input, "a", "q");
    expect(input).toEqual({ a: ["p"] });
  });
});

describe("portRowState", () => {
  it("is unplaced whenever the component is not in the view", () => {
    expect(portRowState({ placed: false, connected: true, shown: true })).toBe(
      "unplaced",
    );
  });

  it("is connected when a drawn edge names the port, shown or not", () => {
    expect(portRowState({ placed: true, connected: true, shown: false })).toBe(
      "connected",
    );
  });

  it("follows the shown flag otherwise", () => {
    expect(portRowState({ placed: true, connected: false, shown: true })).toBe(
      "shown",
    );
    expect(portRowState({ placed: true, connected: false, shown: false })).toBe(
      "hidden",
    );
  });
});
