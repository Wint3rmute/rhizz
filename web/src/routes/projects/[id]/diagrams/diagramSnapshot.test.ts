import { describe, expect, it } from "vitest";
import {
  createHistoryStack,
  pushHistory,
  redoHistory,
  undoHistory,
} from "./history";
import {
  applyDiagramSnapshotContent,
  type DiagramContent,
  snapshotDiagramContent,
} from "./diagramSnapshot";

function emptyContent(): DiagramContent {
  return { checked: {}, savedLayout: {}, connections: {}, annotations: [] };
}

describe("annotation undo/redo (unified layout history)", () => {
  it("adding an annotation is undone/redone", () => {
    const stack = createHistoryStack<DiagramContent>();
    let current = emptyContent();

    // record undo point BEFORE the add (mirrors recordUndoPoint call sites)
    pushHistory(stack, snapshotDiagramContent(current), 100);
    current = {
      ...current,
      annotations: [...current.annotations, { text: "New note", x: 10, y: 20 }],
    };

    const undone = undoHistory(stack, snapshotDiagramContent(current), 100);
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo entry");
    current = applyDiagramSnapshotContent(undone);
    expect(current.annotations).toEqual([]);

    const redone = redoHistory(stack, snapshotDiagramContent(current), 100);
    expect(redone).not.toBeNull();
    if (redone === null) throw new Error("expected redo entry");
    current = applyDiagramSnapshotContent(redone);
    expect(current.annotations).toHaveLength(1);
    expect(current.annotations[0]).toMatchObject({ text: "New note" });
  });

  it("deleting an annotation is undone", () => {
    const stack = createHistoryStack<DiagramContent>();
    const first = { text: "keep", x: 0, y: 0 };
    let current: DiagramContent = {
      ...emptyContent(),
      annotations: [first, { text: "remove", x: 5, y: 5 }],
    };

    pushHistory(stack, snapshotDiagramContent(current), 100);
    current = { ...current, annotations: [first] };

    const undone = undoHistory(stack, snapshotDiagramContent(current), 100);
    expect(undone).not.toBeNull();
    if (undone === null) throw new Error("expected undo entry");
    current = applyDiagramSnapshotContent(undone);
    expect(current.annotations.map((a) => a.text)).toEqual([
      "keep",
      "remove",
    ]);
  });

  it("editing annotation text is undone", () => {
    const stack = createHistoryStack<DiagramContent>();
    let current: DiagramContent = {
      ...emptyContent(),
      annotations: [{ text: "before", x: 0, y: 0 }],
    };

    // undo point recorded when editing STARTS (before keystrokes mutate)
    pushHistory(stack, snapshotDiagramContent(current), 100);
    current = {
      ...current,
      annotations: [{ text: "after", x: 0, y: 0 }],
    };

    const undone = undoHistory(stack, snapshotDiagramContent(current), 100);
    if (undone === null) throw new Error("expected undo entry");
    current = applyDiagramSnapshotContent(undone);
    expect(current.annotations[0]?.text).toBe("before");
  });

  it("dragging an annotation is undone", () => {
    const stack = createHistoryStack<DiagramContent>();
    let current: DiagramContent = {
      ...emptyContent(),
      annotations: [{ text: "note", x: 10, y: 20 }],
    };

    pushHistory(stack, snapshotDiagramContent(current), 100);
    current = {
      ...current,
      annotations: [{ text: "note", x: 99, y: 88 }],
    };

    const undone = undoHistory(stack, snapshotDiagramContent(current), 100);
    if (undone === null) throw new Error("expected undo entry");
    current = applyDiagramSnapshotContent(undone);
    expect(current.annotations[0]).toMatchObject({ x: 10, y: 20 });
  });

  it("resizing an annotation (scale) is undone", () => {
    const stack = createHistoryStack<DiagramContent>();
    let current: DiagramContent = {
      ...emptyContent(),
      annotations: [{ text: "note", x: 0, y: 0, scale: 1 }],
    };

    pushHistory(stack, snapshotDiagramContent(current), 100);
    current = {
      ...current,
      annotations: [{ text: "note", x: 0, y: 0, scale: 2 }],
    };

    const undone = undoHistory(stack, snapshotDiagramContent(current), 100);
    if (undone === null) throw new Error("expected undo entry");
    current = applyDiagramSnapshotContent(undone);
    expect(current.annotations[0]?.scale).toBe(1);
  });

  it("snapshots do not alias the annotations array", () => {
    const current: DiagramContent = {
      ...emptyContent(),
      annotations: [{ text: "note", x: 0, y: 0 }],
    };
    const snap = snapshotDiagramContent(current);
    current.annotations.push({ text: "mutated", x: 1, y: 1 });
    expect(snap.annotations).toHaveLength(1);
  });
});
