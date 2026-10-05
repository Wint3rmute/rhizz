import { describe, expect, it } from "vitest";
import {
  createPaletteIndex,
  paletteRows,
} from "../components/palette/commandPalette";
import type { RawModelPayload } from "../modelView";
import { resolveIcon } from "../iconHelper";
import {
  INVENTORY_GROUP,
  inventoryEntities,
  inventoryItems,
} from "./inventoryItems";

// A model as the compiler hands it over: `definitions` holds arena indices
// into `components`, `systems` are top-level, and everything else is
// addressed through those indices. Shaped after the drone example, which has
// 13 definitions plus instances and a system that must be offered too —
// while instances must NOT be (see inventoryEntities above).
const MODEL: RawModelPayload = {
  systems: [
    { label: "demo-system", full_name: "Demo system", tags: ["demo"] },
  ],
  components: [
    {
      label: "battery",
      full_name: "Stores power",
      icon: "battery-three-quarters",
      tags: ["power"],
    },
    { label: "flight-controller", full_name: "Flies the thing" },
    { label: "barometer", full_name: "Reads the world", icon: "gauge" },
    // An instance, addressed by its source — not a definition.
    { label: "barometer", source: "barometer", parent: { Component: 1 } },
    { label: "quadcopter", parent: { System: 0 } },
  ],
  definitions: [0, 1, 2],
};

describe("inventoryEntities", () => {
  it("lists the top-level definitions followed by the systems, not instances", () => {
    // Definitions and systems are both addressable: Inventory matches the
    // route's label against both lists and switches to the holding tab.
    // Instances are not — an instance is drawn under its usage-site label
    // but addressed by its `source`, so a row for one would silently open
    // the wrong entity.
    expect(inventoryEntities(MODEL).map((e) => e.label)).toEqual([
      "battery",
      "flight-controller",
      "barometer",
      "demo-system",
    ]);
    expect(inventoryEntities(MODEL).map((e) => e.kind)).toEqual([
      "component",
      "component",
      "component",
      "system",
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

  it("carries the icon name off the definition, and nothing where there is none", () => {
    // The name, not drawn geometry: this is the model's own field, and what
    // a caller resolves is its business. An absent icon is the empty string
    // rather than undefined, so the row builder has one thing to test.
    expect(inventoryEntities(MODEL).map((e) => e.icon)).toEqual([
      "battery-three-quarters",
      "",
      "gauge",
      // Systems carry no icon: the schema has no such field, so the row
      // keeps the slot empty like the Inventory card does.
      "",
    ]);
  });

  it("carries the system full name and tags, so a search can match either", () => {
    expect(inventoryEntities(MODEL)[3]).toMatchObject({
      label: "demo-system",
      kind: "system",
      fullName: "Demo system",
      tags: ["demo"],
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
    inventoryEntities(MODEL).push({
      label: "x",
      fullName: "",
      tags,
      kind: "component",
      icon: "",
    });
    expect(tags).toEqual(["power"]);
  });
});

describe("inventoryItems", () => {
  const entities = inventoryEntities(MODEL);

  it("offers one row per entity, labelled the way the command rows read", () => {
    // "Go to component <name>" / "Go to system <name>", so an entity row
    // answers the same question as "Go to Overview" does: the section
    // heading says which list you are in, and the row says what choosing
    // it does.
    const items = inventoryItems(entities, () => {});
    expect(items.map((i) => i.label)).toEqual([
      "Go to component battery",
      "Go to component flight-controller",
      "Go to component barometer",
      "Go to system demo-system",
    ]);
    expect(items[0]?.detail).toBe("Stores power");
    expect(items[3]?.detail).toBe("Demo system");
  });

  it("keeps the bare label as the row's identity, since the label is drawn text", () => {
    // The label is what a screenshot and an accessible name read, so the
    // prefix cannot go into the id too — the id stays the addressable name.
    expect(inventoryItems(entities, () => {}).map((i) => i.id)).toEqual([
      "inventory:battery",
      "inventory:flight-controller",
      "inventory:barometer",
      "inventory:demo-system",
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
      [{ label: "bare", fullName: "", tags: [], kind: "component", icon: "" }],
      () => {},
    );
    expect(bare[0]?.detail).toBeUndefined();
  });

  it("draws the definition's own icon, where a command row draws its glyph", () => {
    // The same leading slot, filled from the model rather than from the
    // page list. A component's icon is a FontAwesome *name*, so the row
    // carries resolved geometry and the shell never learns what a
    // "battery-three-quarters" is — it only draws the path it is handed.
    const [battery, , barometer] = inventoryItems(entities, () => {});
    expect(battery?.icon).toEqual(resolveIcon("battery-three-quarters"));
    expect(barometer?.icon).toEqual(resolveIcon("gauge"));
  });

  it("keeps the slot and leaves it empty for a definition with no icon", () => {
    // `null`, not absent: these rows share one list, and a row that started
    // half a word earlier than its neighbours would read as a mistake rather
    // than as a definition with no icon. Nothing is drawn in the slot.
    const [, controller] = inventoryItems(entities, () => {});
    expect(controller?.icon).toBeNull();
  });

  it("keeps the slot empty for an icon name that resolves to no icon", () => {
    // `icon` is a free-form string in the schema, so a typo or an icon from
    // another icon set is a value the model legitimately holds. It must not
    // become an empty <svg> on the row.
    const [broken] = inventoryItems(
      [{
        label: "x",
        fullName: "",
        tags: [],
        kind: "component",
        icon: "not-an-icon",
      }],
      () => {},
    );
    expect(broken?.icon).toBeNull();
  });

  it("gives every row a distinct id, since the list is keyed on it", () => {
    const ids = inventoryItems(entities, () => {}).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes a row searchable by its full name and its tags", () => {
    const [battery] = inventoryItems(entities, () => {});
    expect(battery?.hint).toContain("Stores power");
    expect(battery?.hint).toContain("power");
    // The icon's *name* deliberately stays out of it: it is matched as text
    // if it were there, and nobody types "battery-three-quarters" looking for
    // the battery. An icon makes a row recognisable once found, not findable.
    expect(battery?.hint).not.toContain("battery-three-quarters");
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
    // And each prefix is a way in, the same as "Go to Overview" is.
    expect(paletteRows(index, "go to component")).toHaveLength(3);
    expect(paletteRows(index, "go to system")).toHaveLength(1);
  });

  it("calls the host back with the bare label, which is what the route addresses", () => {
    // The drawn label and the addressed label are deliberately not the same
    // string any more. This is the guard on that: the prefix is text, and the
    // route still gets the name Inventory matches.
    const seen: string[] = [];
    for (const item of inventoryItems(entities, (l) => seen.push(l))) {
      item.action?.();
    }
    expect(seen).toEqual([
      "battery",
      "flight-controller",
      "barometer",
      "demo-system",
    ]);
  });
});
