import { describe, expect, it } from "vitest";
import {
  completionBadge,
  DEFAULT_VIEW_DIR,
  defaultViewPath,
  definitionDepth,
  definitionLabelForNode,
  filterDefinitions,
  type InventoryDefinition,
  InventoryTab,
  type PortInfo,
  preferredViewSystem,
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

  it("returns all definitions on the All tab", () => {
    expect(filterDefinitions(all, { tab: InventoryTab.All, query: "" }))
      .toEqual(
        all,
      );
  });

  it("returns all definitions on the Components tab (definitions only)", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Components, query: "" }),
    ).toEqual(all);
  });

  it("filters by query across label and full name", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.All, query: "command" }),
    ).toEqual([cm]);
    expect(filterDefinitions(all, { tab: InventoryTab.All, query: "SM" }))
      .toEqual(
        [sm],
      );
  });

  it("matches query against tags too", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.All, query: "propulsion" }),
    ).toEqual([sm]);
  });

  it("returns an empty list when nothing matches (Interfaces tab has no entries yet)", () => {
    expect(
      filterDefinitions(all, { tab: InventoryTab.Interfaces, query: "" }),
    ).toEqual([]);
    expect(
      filterDefinitions(all, { tab: InventoryTab.All, query: "zzz" }),
    ).toEqual([]);
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
