import { describe, expect, it } from "vitest";
import {
  normalizeEndpointRef,
  projectedPortDots,
  resolveConnectionProjection,
  resolveConnectionProjections,
  sidebarProjectionRows,
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

describe("sidebarProjectionRows", () => {
  const conns = [
    { label: "low-link", from: 1, to: 5, fromPort: "input", toPort: "output" },
    { label: "foreign", from: 1, to: 9, fromPort: "input", toPort: "x" },
  ];

  it("lists in-system connections even when nothing is placed", () => {
    expect(sidebarProjectionRows(conns, ctx([]))).toEqual([
      { label: "low-link", shown: false, projected: false },
    ]);
  });

  it("marks projected rows when ancestors are placed", () => {
    expect(sidebarProjectionRows(conns, ctx([0, 4]))).toEqual([
      { label: "low-link", shown: true, projected: true },
    ]);
  });

  it("marks direct rows shown once owners are placed", () => {
    expect(sidebarProjectionRows(conns, ctx([1, 5]))).toEqual([
      { label: "low-link", shown: true, projected: false },
    ]);
  });

  it("keeps hidden connections listed but unchecked", () => {
    expect(
      sidebarProjectionRows(conns, ctx([1, 5], { hidden: ["low-link"] })),
    ).toEqual([{ label: "low-link", shown: false, projected: false }]);
  });

  it("badges hidden projected rows without checking them", () => {
    expect(
      sidebarProjectionRows(conns, ctx([0, 4], { hidden: ["low-link"] })),
    ).toEqual([{ label: "low-link", shown: false, projected: true }]);
  });

  it("never badges projected self-edges", () => {
    const selfEdge = [
      { label: "inner", from: 1, to: 2, fromPort: "input", toPort: "loop" },
    ];
    expect(sidebarProjectionRows(selfEdge, ctx([0]))).toEqual([
      { label: "inner", shown: false, projected: false },
    ]);
  });

  it("groups copies by name and sorts rows by label", () => {
    const copies = [
      { label: "zeta", from: 1, to: 5, fromPort: "input", toPort: "output" },
      { label: "alpha", from: 1, to: 2, fromPort: "input", toPort: "loop" },
      { label: "zeta", from: 4, to: 4, fromPort: "a", toPort: "b" },
    ];
    expect(sidebarProjectionRows(copies, ctx([0, 4]))).toEqual([
      { label: "alpha", shown: false, projected: false },
      { label: "zeta", shown: true, projected: true },
    ]);
  });
});

describe("normalizeEndpointRef", () => {
  it("reads wasm snake_case port getters", () => {
    expect(
      normalizeEndpointRef({
        label: "a",
        from: 1,
        to: 2,
        from_port: "in",
        to_port: "out",
      }),
    ).toEqual({ label: "a", from: 1, to: 2, fromPort: "in", toPort: "out" });
  });

  it("prefers camelCase ports and tolerates bare endpoints", () => {
    expect(
      normalizeEndpointRef({
        label: "a",
        from: 1,
        to: 2,
        fromPort: "in",
        from_port: "stale",
      }),
    ).toEqual({
      label: "a",
      from: 1,
      to: 2,
      fromPort: "in",
      toPort: undefined,
    });
    expect(normalizeEndpointRef({ label: "b", from: 1, to: 2 })).toEqual({
      label: "b",
      from: 1,
      to: 2,
      fromPort: undefined,
      toPort: undefined,
    });
  });
});

describe("projectedPortDots", () => {
  const conns = [
    { label: "low-link", from: 1, to: 5, fromPort: "input", toPort: "output" },
  ];
  // Keys mirror Model::component_keys ("sys/..." paths); ports mirror the
  // descendant definitions the projection resolves through.
  const portTable: Record<
    string,
    { label: string; role?: string; protocol?: string }[]
  > = {
    "sys/A/B": [{ label: "input", role: "consumer", protocol: "sig" }],
    "sys/C/E": [{ label: "output", role: "provider", protocol: "sig" }],
  };
  const portsOf = (key: string) => portTable[key];
  const keysOf = (index: number) =>
    (
      ["sys/A", "sys/A/B", "sys/A/f2", "sys/A/B/C", "sys/C", "sys/C/E"] as const
    )[index] ?? `#${String(index)}`;

  it("emits dots with inherited role and protocol", () => {
    expect(projectedPortDots(conns, ctx([0, 4]), keysOf, portsOf)).toEqual([
      { ancestor: 0, label: "B/input", role: "consumer", protocol: "sig" },
      { ancestor: 4, label: "E/output", role: "provider", protocol: "sig" },
    ]);
  });

  it("skips direct endpoints and bare ends", () => {
    expect(projectedPortDots(conns, ctx([1, 5]), keysOf, portsOf)).toEqual([]);
    expect(
      projectedPortDots(
        [{ label: "bare", from: 1, to: 4 }],
        ctx([0, 4]),
        keysOf,
        portsOf,
      ),
    ).toEqual([]);
  });

  it("falls back to peer/untyped when the descendant port is gone", () => {
    expect(
      projectedPortDots(conns, ctx([0, 4]), keysOf, () => undefined),
    ).toEqual([
      { ancestor: 0, label: "B/input", role: "peer", protocol: undefined },
      { ancestor: 4, label: "E/output", role: "peer", protocol: undefined },
    ]);
  });

  it("dedupes one dot per ancestor and label", () => {
    const copies = [...conns, ...conns];
    expect(
      projectedPortDots(copies, ctx([0, 4]), keysOf, portsOf),
    ).toHaveLength(2);
  });
});

describe("ancestor-descendant projections", () => {
  // 3:C lives under 1:B under 0:A; 2:f2 lives directly under 0:A.
  // Placing A and B while C stays hidden resolves C's end onto A —
  // an ancestor reaching into its own descendant — which must omit.
  const inwards = {
    label: "t",
    from: 3,
    to: 2,
    fromPort: "deep",
    toPort: "loop",
  };

  it("omits both orientations", () => {
    expect(resolveConnectionProjection(inwards, ctx([0, 1])).kind).toBe(
      "omitted",
    );
    expect(
      resolveConnectionProjection(
        { ...inwards, from: 2, to: 3, fromPort: "loop", toPort: "deep" },
        ctx([0, 1]),
      ).kind,
    ).toBe("omitted");
  });

  it("keeps direct ancestor-descendant system connections", () => {
    expect(
      resolveConnectionProjection(
        { label: "t", from: 0, to: 1, fromPort: "p", toPort: "q" },
        ctx([0, 1]),
      ).kind,
    ).toBe("direct");
  });

  it("lists the row unchecked and unbadged, and draws no dot", () => {
    expect(sidebarProjectionRows([inwards], ctx([0, 1]))).toEqual([
      { label: "t", shown: false, projected: false },
    ]);
    const keysOf = (index: number) =>
      (["sys/A", "sys/A/B", "sys/A/f2", "sys/A/B/C"] as const)[index] ??
      `#${String(index)}`;
    expect(
      projectedPortDots([inwards], ctx([0, 1]), keysOf, () => undefined),
    ).toEqual([]);
  });
});
