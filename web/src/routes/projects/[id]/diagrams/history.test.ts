import { describe, expect, it } from "vitest";
import {
  createHistoryStack,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";

describe("pushHistory", () => {
  it("adds a snapshot to the undo stack", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "a", 100);
    expect(stack.undoStack).toEqual(["a"]);
  });

  it("clears any existing redo history", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "a", 100);
    undoHistory(stack, "b", 100); // "b" -> redo stack, "a" popped
    expect(stack.redoStack.length).toBe(1);

    pushHistory(stack, "c", 100);
    expect(stack.redoStack).toEqual([]);
  });

  it("discards the oldest entries once the limit is exceeded", () => {
    const stack = createHistoryStack<number>();
    for (let i = 0; i < 5; i++) pushHistory(stack, i, 3);
    expect(stack.undoStack).toEqual([2, 3, 4]);
  });
});

describe("undoHistory", () => {
  it("returns null when there's nothing to undo", () => {
    const stack = createHistoryStack<string>();
    expect(undoHistory(stack, "current", 100)).toBeNull();
  });

  it("returns the most recent snapshot and removes it from the undo stack", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "a", 100);
    pushHistory(stack, "b", 100);

    expect(undoHistory(stack, "c", 100)).toBe("b");
    expect(stack.undoStack).toEqual(["a"]);
  });

  it("pushes the current state onto the redo stack", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "a", 100);

    undoHistory(stack, "current", 100);
    expect(stack.redoStack).toEqual(["current"]);
  });

  it("respects the limit when the redo stack grows", () => {
    const stack = createHistoryStack<number>();
    pushHistory(stack, 0, 100);
    for (let i = 1; i <= 5; i++) {
      pushHistory(stack, i, 100);
      undoHistory(stack, i, 2);
    }
    expect(stack.redoStack.length).toBeLessThanOrEqual(2);
  });
});

describe("redoHistory", () => {
  it("returns null when there's nothing to redo", () => {
    const stack = createHistoryStack<string>();
    expect(redoHistory(stack, "current", 100)).toBeNull();
  });

  it("restores what undoHistory most recently moved to the redo stack", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "a", 100);
    pushHistory(stack, "b", 100);

    const undone = undoHistory(stack, "c", 100); // "b" is undone, "c" -> redo
    expect(undone).toBe("b");

    const redone = redoHistory(stack, "b", 100); // "c" is redone, "b" -> undo
    expect(redone).toBe("c");
    expect(stack.undoStack).toEqual(["a", "b"]);
  });

  it("supports a full undo -> redo -> undo round trip", () => {
    const stack = createHistoryStack<string>();
    pushHistory(stack, "v1", 100);

    const back = undoHistory(stack, "v2", 100);
    expect(back).toBe("v1");

    const forward = redoHistory(stack, "v1", 100);
    expect(forward).toBe("v2");

    const backAgain = undoHistory(stack, "v2", 100);
    expect(backAgain).toBe("v1");
  });
});
