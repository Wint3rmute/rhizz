import { describe, expect, it } from "vitest";
import {
  resolveConnectionProjection,
  resolveConnectionProjections,
  type ProjectionContext,
} from "./connectionProjection";

// Hierarchy used across tests (arena indices):
//   0:A (label "A")
//   ├─ 1:B (label "B", parent 0) port "input"
//   │  └─ 3:C (label "C", parent 1) port "deep"
//   └─ 2:f2 (label "f2", parent 0)
//   4:D (label "D") port "output"
//   └─ 5:E (label "E", parent 4) port "output"
const labels = ["A", "B", "f2", "C", "D", "E"];
const parents = [undefined, 0, 0, 1, undefined, 4] as const;

function ctx(
  placed: readonly number[],
  opts?: { inSystem?: readonly number[]; hidden?: readonly string[] },
): ProjectionContext {
  const inSys = new Set(opts?.inSystem ?? [0, 1, 2, 3, 4, 5]);
  const hiddenLabels = new Set(opts?.hidden ?? []);
  return {
    placed: new Set(placed),
    inSystem: (index: number) => inSys.has(index),
    parentOf: (index: number) => parents[index],
    labelOf: (index: number) => labels[index] ?? `#${String(index)}`,
    isHidden: (label: string) => hiddenLabels.has(label),
  };
}

describe("resolveConnectionProjection", () => {
  it("is direct when both owners are placed", () => {
    expect(
      resolveConnectionProjection(
        { label: "sig", from: 1, to: 5, fromPort: "input", toPort: "output" },
        ctx([1, 5]),
      ),
    ).toEqual({
      kind: "direct",
      from: 1,
      to: 5,
      fromPort: "input",
      toPort: "output",
      hidden: false,
    });
  });

  it("projects a hidden endpoint onto the nearest visible ancestor", () => {
    expect(
      resolveConnectionProjection(
        {
          label: "low-link",
          from: 1,
          to: 5,
          fromPort: "input",
          toPort: "output",
        },
        ctx([0, 4]),
      ),
    ).toEqual({
      kind: "projected",
      from: 0,
      to: 4,
      fromPort: "B/input",
      toPort: "E/output",
      hidden: false,
    });
  });

  it("derives nested projected names relative to the rendering ancestor", () => {
    expect(
      resolveConnectionProjection(
        {
          label: "deep-link",
          from: 3,
          to: 5,
          fromPort: "deep",
          toPort: "output",
        },
        ctx([0, 4]),
      ),
    ).toEqual({
      kind: "projected",
      from: 0,
      to: 4,
      fromPort: "B/C/deep",
      toPort: "E/output",
      hidden: false,
    });
  });

  it("shortens the relative path when an intermediate ancestor is placed", () => {
    expect(
      resolveConnectionProjection(
        {
          label: "deep-link",
          from: 3,
          to: 5,
          fromPort: "deep",
          toPort: "output",
        },
        ctx([1, 4]),
      ),
    ).toEqual({
      kind: "projected",
      from: 1,
      to: 4,
      fromPort: "C/deep",
      toPort: "E/output",
      hidden: false,
    });
  });

  it("allows one direct endpoint and one projected endpoint", () => {
    expect(
      resolveConnectionProjection(
        { label: "mix", from: 1, to: 5, fromPort: "input", toPort: "output" },
        ctx([1, 4]),
      ),
    ).toEqual({
      kind: "projected",
      from: 1,
      to: 4,
      fromPort: "input",
      toPort: "E/output",
      hidden: false,
    });
  });

  it("omits when an endpoint has no visible ancestor", () => {
    expect(
      resolveConnectionProjection(
        {
          label: "low-link",
          from: 1,
          to: 5,
          fromPort: "input",
          toPort: "output",
        },
        ctx([0]),
      ).kind,
    ).toBe("omitted");
  });

  it("omits projected self-edges but keeps direct self-connections", () => {
    // f1-style internal connection: both ends under A, only A placed.
    expect(
      resolveConnectionProjection(
        { label: "inner", from: 1, to: 2, fromPort: "input", toPort: "loop" },
        ctx([0]),
      ).kind,
    ).toBe("omitted");
    // Genuine system self-connection on the placed component itself.
    expect(
      resolveConnectionProjection(
        { label: "loopback", from: 0, to: 0, fromPort: "p", toPort: "q" },
        ctx([0]),
      ).kind,
    ).toBe("direct");
  });

  it("resolves copies sharing a name independently", () => {
    const results = resolveConnectionProjections(
      [
        { label: "inner", from: 1, to: 2, fromPort: "input", toPort: "loop" },
        { label: "inner", from: 4, to: 4, fromPort: "a", toPort: "b" },
      ],
      ctx([0, 4]),
    );
    expect(results.map((r) => r.kind)).toEqual(["omitted", "direct"]);
  });

  it("exposes hidden separately so the sidebar can stay listed", () => {
    expect(
      resolveConnectionProjection(
        {
          label: "low-link",
          from: 1,
          to: 5,
          fromPort: "input",
          toPort: "output",
        },
        ctx([0, 4], { hidden: ["low-link"] }),
      ),
    ).toMatchObject({ kind: "projected", hidden: true });
  });

  it("keeps bare endpoints portless when projecting", () => {
    expect(
      resolveConnectionProjection(
        { label: "bare", from: 1, to: 4 },
        ctx([0, 4]),
      ),
    ).toEqual({
      kind: "projected",
      from: 0,
      to: 4,
      fromPort: undefined,
      toPort: undefined,
      hidden: false,
    });
  });
});
