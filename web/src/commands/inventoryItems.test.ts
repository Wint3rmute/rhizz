import { describe, expect, it } from "vitest";
import {
  createPaletteIndex,
  paletteRows,
} from "../components/palette/commandPalette";
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

  it("offers one row per entity, labelled the way the command rows read", () => {
    // "Go to component <name>", so an entity row answers the same question
    // as "Go to Overview" does: the section heading says which list you are
    // in, and the row says what choosing it does.
    const items = inventoryItems(entities, () => {});
    expect(items.map((i) => i.label)).toEqual([
      "Go to component battery",
      "Go to component flight-controller",
      "Go to component barometer",
    ]);
    expect(items[0]?.detail).toBe("Stores power");
  });

  it("keeps the bare label as the row's identity, since the label is drawn text", () => {
    // The label is what a screenshot and an accessible name read, so the
    // prefix cannot go into the id too — the id stays the addressable name.
    expect(inventoryItems(entities, () => {}).map((i) => i.id)).toEqual([
      "inventory:battery",
      "inventory:flight-controller",
      "inventory:barometer",
    ]);
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

  it("is still found by the bare name, now that the prefix is drawn", () => {
    // The prefix pushes the name 17 characters to the right, so this runs
    // through the real Fuse index rather than asserting the label by hand:
    // the risk being pinned is that the drawn wording quietly stops being
    // searchable, which no assertion on `label` alone would catch.
    const index = createPaletteIndex(inventoryItems(entities, () => {}));
    for (const query of ["barometer", "battery", "flight-controller"]) {
      expect(paletteRows(index, query).map((row) => row.item.id)).toContain(
        `inventory:${query}`,
      );
    }
    // And the prefix itself is a way in, the same as "Go to Overview" is.
    expect(paletteRows(index, "go to component")).toHaveLength(3);
  });

  it("calls the host back with the bare label, which is what the route addresses", () => {
    // The drawn label and the addressed label are deliberately not the same
    // string any more. This is the guard on that: the prefix is text, and the
    // route still gets the name Inventory matches.
    const seen: string[] = [];
    for (const item of inventoryItems(entities, (l) => seen.push(l))) {
      item.action?.();
    }
    expect(seen).toEqual(["battery", "flight-controller", "barometer"]);
  });
});
