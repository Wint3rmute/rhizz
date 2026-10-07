import { describe, expect, it } from "vitest";
import {
  completionBadge,
  DEFAULT_VIEW_DIR,
  defaultViewPath,
  definitionDepth,
  definitionLabelForNode,
  filterDefinitions,
  filterSystems,
  instancePathsForDefinition,
  type InventoryDefinition,
  type InventorySystem,
  InventoryTab,
  type PortInfo,
  preferredViewSystem,
  systemAsDefinition,
  viewsBoundToSystem,
} from "./inventory";

function def(
  overrides: Partial<InventoryDefinition> = {},
): InventoryDefinition {
  return {
    label: "cm",
    full_name: "Command module",
    tags: [],
    level: 1,
    leaf: false,
    children: [],
    ports: [],
    icon: undefined,
    color: undefined,
    border: undefined,
    font: undefined,
    ...overrides,
  };
}

function port(overrides: Partial<PortInfo> = {}): PortInfo {
  return {
    label: "power",
    protocol: "power",
    role: "provider",
    external: false,
    required: true,
    full_name: "",
    ...overrides,
  };
}

describe("definitionDepth", () => {
  it("returns 1 for a definition with no children", () => {
    expect(definitionDepth(def())).toBe(1);
  });

  it("returns 1 + nesting depth for nested children", () => {
    const nested = def({
      children: [def({ children: [def({ children: [def()] })] })],
    });
    expect(definitionDepth(nested)).toBe(4);
  });
});

describe("completionBadge", () => {
  it("returns 100% Specified for a complete leaf (full name present)", () => {
    expect(completionBadge(def({ leaf: true }))).toEqual({
      kind: "specified",
      percent: 100,
    });
  });

  it("returns a partial percentage for a leaf without full name", () => {
    expect(completionBadge(def({ leaf: true, full_name: "" }))).toEqual({
      kind: "partial",
      percent: 50,
    });
  });

  it("returns Draft for a non-leaf definition without children", () => {
    expect(completionBadge(def())).toEqual({ kind: "draft", percent: 0 });
  });

  it("returns 100% Specified when all children are complete", () => {
    const d = def({ children: [def({ leaf: true }), def({ leaf: true })] });
    expect(completionBadge(d)).toEqual({ kind: "specified", percent: 100 });
  });

  it("returns a partial percentage when some children are incomplete", () => {
    const d = def({
      children: [def({ leaf: true }), def({ leaf: true, full_name: "" })],
    });
    const badge = completionBadge(d);
    expect(badge.kind).toBe("partial");
    expect(badge.percent).toBeLessThan(100);
    expect(badge.percent).toBeGreaterThan(0);
  });

  it("ignores ports when scoring (leaf with full name + no ports is complete)", () => {
    const d = def({ leaf: true, ports: [port()] });
    expect(completionBadge(d)).toEqual({ kind: "specified", percent: 100 });
  });
});

describe("filterDefinitions", () => {
  const cm = def({ label: "cm", full_name: "Command module" });
  const sm = def({
    label: "sm",
    full_name: "Service module",
    tags: ["propulsion"],
  });
  const all = [cm, sm];

  it("returns all definitions on the Components tab", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Components, query: "" }),
    ).toEqual(all);
  });

  it("returns no definitions on the Systems tab (systems have their own list)", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Systems, query: "" }),
    ).toEqual([]);
  });

  it("returns all definitions on the Components tab (definitions only)", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Components, query: "" }),
    ).toEqual(all);
  });

  it("filters by query across label and full name", () => {
    expect(
      filterDefinitions(all, {
        tab: InventoryTab.Components,
        query: "command",
      }),
    ).toEqual([cm]);
    expect(
      filterDefinitions(all, { tab: InventoryTab.Components, query: "SM" }),
    ).toEqual([sm]);
  });

  it("matches query against tags too", () => {
    expect(
      filterDefinitions(
        all,
        { tab: InventoryTab.Components, query: "propulsion" },
      ),
    ).toEqual([sm]);
  });

  it("returns an empty list when nothing matches (Interfaces tab has no entries yet)", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Interfaces, query: "" }),
    ).toEqual([]);
    expect(
      filterDefinitions(all, { tab: InventoryTab.Components, query: "zzz" }),
    ).toEqual([]);
  });
});

describe("filterSystems", () => {
  const sys = (overrides: Partial<InventorySystem> = {}): InventorySystem => ({
    label: "demo-system",
    full_name: "Demo system",
    tags: [],
    ...overrides,
  });
  const a = sys({ label: "a-system", full_name: "A system" });
  const b = sys({
    label: "b-system",
    full_name: "B system",
    tags: ["propulsion"],
  });

  it("returns all systems on an empty query", () => {
    expect(filterSystems([a, b], "")).toEqual([a, b]);
  });

  it("filters by label, full name and tags", () => {
    expect(filterSystems([a, b], "A-SYSTEM")).toEqual([a]);
    expect(filterSystems([a, b], "propulsion")).toEqual([b]);
    expect(filterSystems([a, b], "zzz")).toEqual([]);
  });
});

describe("systemAsDefinition", () => {
  it("reuses the system label for the views/<label>.hcl convention", () => {
    const d = systemAsDefinition({
      label: "demo-system",
      full_name: "Demo",
      tags: ["t"],
    });
    expect(d.label).toBe("demo-system");
    expect(d.full_name).toBe("Demo");
    expect(d.tags).toEqual(["t"]);
    expect(defaultViewPath(d.label)).toBe("views/demo-system.hcl");
  });

  it("carries the system icon, but no component-only style", () => {
    const d = systemAsDefinition({
      label: "demo-system",
      full_name: "Demo",
      icon: "rocket",
      tags: [],
    });
    expect(d.icon).toBe("rocket");
    expect(d.color).toBeUndefined();
    expect(d.border).toBeUndefined();
    expect(d.font).toBeUndefined();
  });
});

describe("defaultViewPath", () => {
  it("builds the conventional views/<label>.hcl path", () => {
    expect(defaultViewPath("cm")).toBe("views/cm.hcl");
    expect(DEFAULT_VIEW_DIR).toBe("views");
  });
});

describe("preferredViewSystem", () => {
  it("returns the system containing an instance of the definition", () => {
    const components = [
      { source: undefined, parent: { System: 1 } },
      { source: "motor", parent: { System: 1 } },
    ];
    expect(preferredViewSystem(components, ["a", "b"], "motor")).toBe("b");
  });

  it("follows nested component parents up to the system", () => {
    const components = [
      { source: "motor", parent: { Component: 1 } },
      { source: undefined, parent: { System: 0 } },
    ];
    expect(preferredViewSystem(components, ["a"], "motor")).toBe("a");
  });

  it("falls back to the first system when the definition is never instantiated", () => {
    expect(preferredViewSystem([], ["a", "b"], "motor")).toBe("a");
  });

  it("falls back to main when the model has no systems", () => {
    expect(preferredViewSystem([], [], "motor")).toBe("main");
  });
});

describe("definitionLabelForNode", () => {
  // A placed node is addressed by its arena index, which is shared with the
  // typed model (see componentDataByKey), and this list is the only thing that
  // can say what focusing it means — so these are the two questions the click
  // has to answer: which definition is this node, and is it one this page can
  // open at all?
  const raw = {
    components: [
      { label: "controller" }, // 0: a definition, no source
      { label: "main-chip", source: "mcu" }, // 1: an instance, renamed
      { label: "loose", source: "not-a-definition" }, // 2: dangling source
      { label: "mcu" }, // 3: the definition itself
      { label: "demo-system", parent: { System: 0 } }, // 4: a system
    ],
  };
  const DEFINITIONS = ["controller", "mcu"];

  it("answers a definition node with its own label", () => {
    expect(definitionLabelForNode(raw, DEFINITIONS, 0)).toBe("controller");
    expect(definitionLabelForNode(raw, DEFINITIONS, 3)).toBe("mcu");
  });

  it("answers an instance with the definition it was sourced from", () => {
    // Not the label on the canvas. `instance "main-chip" { source = "mcu" }`
    // is drawn as "main-chip" and addressed as "mcu", and only the second one
    // names something this page can open — which is the whole reason the
    // resolver exists rather than reading the node's label.
    expect(definitionLabelForNode(raw, DEFINITIONS, 1)).toBe("mcu");
  });

  it("answers null for a node this page cannot open", () => {
    // A source naming something that is not a listed definition, and a system
    // node, are both drawn on a canvas and neither is addressable here. Clicking
    // them must do nothing rather than navigate somewhere meaningless.
    expect(definitionLabelForNode(raw, DEFINITIONS, 2)).toBeNull();
    expect(definitionLabelForNode(raw, DEFINITIONS, 4)).toBeNull();
  });

  it("answers null for an index the model does not have", () => {
    expect(definitionLabelForNode(raw, DEFINITIONS, 99)).toBeNull();
    expect(definitionLabelForNode(undefined, DEFINITIONS, 0)).toBeNull();
    expect(definitionLabelForNode({}, DEFINITIONS, 0)).toBeNull();
  });

  it("treats an empty source as no source", () => {
    // The payload spells "no source" as "" as often as it omits it, and an
    // empty string must not be read as a definition named "".
    expect(
      definitionLabelForNode(
        { components: [{ label: "battery", source: "" }] },
        ["battery"],
        0,
      ),
    ).toBe("battery");
  });
});

describe("instancePathsForDefinition", () => {
  // Arena indices shared with the typed model (`component_keys`), so the
  // Delete tab can name every placement of a definition.
  const components = [
    { label: "controller" },
    { label: "main-chip", source: "mcu", parent: { System: 0 } },
    { label: "spare", source: "mcu", parent: { System: 1 } },
    { label: "mcu" },
  ];
  const keys = [
    "controller",
    "demo/main-chip",
    "other/spare",
    "mcu",
  ];

  it("lists the key of every instance sourced from the definition", () => {
    expect(instancePathsForDefinition(components, keys, "mcu")).toEqual([
      "demo/main-chip",
      "other/spare",
    ]);
  });

  it("ignores empty sources and returns [] when unused", () => {
    expect(
      instancePathsForDefinition(
        [{ label: "battery", source: "" }],
        ["battery"],
        "battery",
      ),
    ).toEqual([]);
    expect(instancePathsForDefinition(components, keys, "controller")).toEqual(
      [],
    );
  });
});

describe("viewsBoundToSystem", () => {
  const views = [
    { path: "views/demo.hcl", system: "demo" },
    { path: "views/other.hcl", system: "other" },
    { path: "views/unbound.hcl", system: "" },
  ];

  it("lists the view files bound to the system", () => {
    expect(viewsBoundToSystem(views, "demo")).toEqual(["views/demo.hcl"]);
  });

  it("returns [] when nothing is bound to the system", () => {
    expect(viewsBoundToSystem(views, "missing")).toEqual([]);
  });
});
