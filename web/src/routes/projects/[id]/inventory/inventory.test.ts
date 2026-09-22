import { describe, expect, it } from "vitest";
import {
  completionBadge,
  DEFAULT_VIEW_DIR,
  defaultViewPath,
  definitionDepth,
  filterDefinitions,
  type InventoryDefinition,
  InventoryTab,
  type PortInfo,
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
