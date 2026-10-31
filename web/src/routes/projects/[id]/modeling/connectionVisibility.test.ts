import { describe, expect, it } from "vitest";
import {
  drawnConnections,
  isConnectionDrawn,
  sidebarConnectionRows,
} from "./connectionVisibility";

const inSystem = (members: readonly number[]) => (index: number) =>
  members.includes(index);
const hidden = (labels: readonly string[]) => (label: string) =>
  labels.includes(label);

describe("isConnectionDrawn", () => {
  it("draws when both endpoints are placed, in-system, and not hidden", () => {
    expect(
      isConnectionDrawn(
        { label: "a", from: 0, to: 1 },
        new Set([0, 1]),
        inSystem([0, 1]),
        hidden([]),
      ),
    ).toBe(true);
  });

  const skips: [
    string,
    Set<number>,
    (index: number) => boolean,
    (label: string) => boolean,
  ][] = [
    ["unplaced endpoint", new Set([0]), inSystem([0, 1]), hidden([])],
    ["outside the view's system", new Set([0, 1]), inSystem([0]), hidden([])],
    ["hidden label", new Set([0, 1]), inSystem([0, 1]), hidden(["a"])],
  ];
  it.each(skips)("skips when %s", (_reason, placed, inSys, isHidden) => {
    expect(
      isConnectionDrawn(
        { label: "a", from: 0, to: 1 },
        placed,
        inSys,
        isHidden,
      ),
    ).toBe(false);
  });
});

describe("sidebarConnectionRows", () => {
  it("lists only connections with both endpoints placed in-system", () => {
    const rows = sidebarConnectionRows(
      [
        { label: "shown", from: 0, to: 1 },
        { label: "unplaced", from: 0, to: 2 },
        { label: "foreign", from: 0, to: 3 },
      ],
      new Set([0, 1, 2, 3]),
      inSystem([0, 1, 2]),
      hidden([]),
    );
    expect(rows).toEqual([
      { label: "shown", shown: true },
      { label: "unplaced", shown: true },
    ]);
  });

  it("keeps hidden connections listed but unchecked", () => {
    const rows = sidebarConnectionRows(
      [{ label: "a", from: 0, to: 1 }],
      new Set([0, 1]),
      inSystem([0, 1]),
      hidden(["a"]),
    );
    expect(rows).toEqual([{ label: "a", shown: false }]);
  });

  it("groups copies by name: listed and checked if any copy is drawn", () => {
    const rows = sidebarConnectionRows(
      [
        { label: "data", from: 0, to: 1 },
        { label: "data", from: 2, to: 3 },
      ],
      new Set([0, 1]),
      inSystem([0, 1, 2, 3]),
      hidden([]),
    );
    expect(rows).toEqual([{ label: "data", shown: true }]);
  });

  it("hiding applies to all copies", () => {
    const rows = sidebarConnectionRows(
      [
        { label: "data", from: 0, to: 1 },
        { label: "data", from: 2, to: 3 },
      ],
      new Set([0, 1, 2, 3]),
      inSystem([0, 1, 2, 3]),
      hidden(["data"]),
    );
    expect(rows).toEqual([{ label: "data", shown: false }]);
  });
});

describe("drawnConnections", () => {
  it("keeps only drawn copies", () => {
    const conns = [
      { label: "a", from: 0, to: 1 },
      { label: "b", from: 0, to: 2 },
      { label: "c", from: 0, to: 1 },
    ];
    expect(
      drawnConnections(conns, new Set([0, 1]), inSystem([0, 1]), hidden(["c"])),
    ).toEqual([{ label: "a", from: 0, to: 1 }]);
  });
});
