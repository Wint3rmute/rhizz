import { describe, expect, it } from "vitest";
import type { RawModelPayload } from "../modelView";
import {
  INVENTORY_GROUP,
  inventoryEntities,
  inventoryItems,
} from "./inventoryItems";

// A model as the compiler hands it over: `definitions` holds arena indices
// into `components`, and everything else is addressed through those indices.
// Shaped after the drone example, which has 13 definitions plus instances
// and systems that must NOT be offered (see inventoryEntities below).
const MODEL: RawModelPayload = {
  components: [
    { label: "battery", full_name: "Stores power", tags: ["power"] },
    { label: "flight-controller", full_name: "Flies the thing" },
    { label: "barometer", full_name: "Reads the world" },
    // An instance, addressed by its source — not a definition.
    { label: "barometer", source: "barometer", parent: { Component: 1 } },
    { label: "quadcopter", parent: { System: 0 } },
  ],
  definitions: [0, 1, 2],
};

describe("inventoryEntities", () => {
  it("lists the top-level definitions, not instances or systems", () => {
    // Only `definitions` is addressable: Inventory matches the route's label
    // against that list and falls back to the first row for anything else,
    // so a system or an instance row would silently open the wrong entity.
    expect(inventoryEntities(MODEL).map((e) => e.label)).toEqual([
      "battery",
      "flight-controller",
      "barometer",
    ]);
  });

  it("carries the full name and tags, so a search can match either", () => {
    const [battery] = inventoryEntities(MODEL);
    expect(battery).toMatchObject({
      label: "battery",
      fullName: "Stores power",
      tags: ["power"],
    });
    expect(inventoryEntities(MODEL)[1]).toMatchObject({
      label: "flight-controller",
      fullName: "Flies the thing",
      tags: [],
    });
  });

  it("yields nothing for a model that failed to compile", () => {
    expect(inventoryEntities(undefined)).toEqual([]);
    expect(inventoryEntities({})).toEqual([]);
  });

  it("skips a definition index the arena does not answer for", () => {
    // A dangling index should not become a row labelled "#3" that opens
    // nothing; there is simply no such entity to go to.
    expect(
      inventoryEntities({
        components: [{ label: "battery" }],
        definitions: [0, 7],
      })
        .map((e) => e.label),
    ).toEqual(["battery"]);
  });

  it("never mutates the tags it was handed", () => {
    const tags = ["power"];
    inventoryEntities(MODEL).push({ label: "x", fullName: "", tags });
    expect(tags).toEqual(["power"]);
  });
});

describe("inventoryItems", () => {
  const entities = inventoryEntities(MODEL);

  it("offers one row per entity, labelled by its name in Inventory", () => {
    const items = inventoryItems(entities, () => {});
    expect(items.map((i) => i.label)).toEqual([
      "battery",
      "flight-controller",
      "barometer",
    ]);
    expect(items[0]?.detail).toBe("Stores power");
  });

  it("puts them in their own section, alongside the other two", () => {
    expect(new Set(inventoryItems(entities, () => {}).map((i) => i.group)))
      .toEqual(
        new Set([INVENTORY_GROUP]),
      );
  });

  it("shows the full name only when there is one", () => {
    const items = inventoryItems(entities, () => {});
    expect(items[1]?.detail).toBe("Flies the thing");
    const bare = inventoryItems(
      [{ label: "bare", fullName: "", tags: [] }],
      () => {},
    );
    expect(bare[0]?.detail).toBeUndefined();
  });

  it("gives every row a distinct id, since the list is keyed on it", () => {
    const ids = inventoryItems(entities, () => {}).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes a row searchable by its full name and its tags", () => {
    const [battery] = inventoryItems(entities, () => {});
    expect(battery?.hint).toContain("Stores power");
    expect(battery?.hint).toContain("power");
  });

  it("calls the host back with the label, which is what the route addresses", () => {
    const seen: string[] = [];
    for (const item of inventoryItems(entities, (l) => seen.push(l))) {
      item.action?.();
    }
    expect(seen).toEqual(["battery", "flight-controller", "barometer"]);
  });
});
