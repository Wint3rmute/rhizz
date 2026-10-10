import { afterEach, describe, expect, it, vi } from "vitest";
import { beginPaneDrag, endPaneDrag } from "./dragGuard";

function stubDocument() {
  const add = vi.fn();
  const remove = vi.fn();
  Object.defineProperty(globalThis, "document", {
    value: { body: { classList: { add, remove } } },
    writable: true,
    configurable: true,
  });
  return { add, remove };
}

afterEach(() => {
  // Bare node has no document; restore that between tests. Each test also
  // leaves the guard balanced (every begin matched by an end).
  Reflect.deleteProperty(globalThis, "document");
});

describe("pane drag guard", () => {
  it("adds the guard class on begin and removes it on end", () => {
    const { add, remove } = stubDocument();
    beginPaneDrag();
    expect(add).toHaveBeenCalledWith("pane-dragging");
    endPaneDrag();
    expect(remove).toHaveBeenCalledWith("pane-dragging");
  });

  it("keeps the guard across overlapping drags until the last one ends", () => {
    const { remove } = stubDocument();
    beginPaneDrag();
    beginPaneDrag();
    endPaneDrag();
    expect(remove).not.toHaveBeenCalled();
    endPaneDrag();
    expect(remove).toHaveBeenCalledWith("pane-dragging");
  });

  it("ignores an end without a matching begin", () => {
    const { remove } = stubDocument();
    endPaneDrag();
    expect(remove).toHaveBeenCalledWith("pane-dragging");
  });

  it("stays quiet without any DOM", () => {
    expect(() => {
      beginPaneDrag();
    }).not.toThrow();
    expect(() => {
      endPaneDrag();
    }).not.toThrow();
  });
});
