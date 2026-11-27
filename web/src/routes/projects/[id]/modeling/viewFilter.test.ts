import { describe, expect, it } from "vitest";
import {
  addFilterTag,
  type FilterableComponent,
  missingFilteredComponents,
  removeFilterTag,
} from "./viewFilter";

// quad (system 0): drone > battery[power], esc[power, motor], camera[video]
// spare (system 1): battery[power]
// a bare `battery` definition (no parent) tagged power.
const components: FilterableComponent[] = [
  { label: "drone", parent_system_index: 0, tags: [] },
  { label: "battery", parent_component_index: 0, tags: ["power"] },
  { label: "esc", parent_component_index: 0, tags: ["power", "motor"] },
  { label: "camera", parent_component_index: 0, tags: ["video"] },
  { label: "battery", parent_system_index: 1, tags: ["power"] },
  { label: "battery", tags: ["power"] },
];
const keys = [
  "quad/drone",
  "quad/drone/battery",
  "quad/drone/esc",
  "quad/drone/camera",
  "spare/battery",
  "battery",
];

describe("missingFilteredComponents", () => {
  it("requires nothing without include tags", () => {
    expect(
      missingFilteredComponents(components, keys, 0, [], new Set()),
    ).toEqual([]);
  });

  it("lists tagged components of the view's system that are not placed", () => {
    const missing = missingFilteredComponents(
      components,
      keys,
      0,
      ["power"],
      new Set(["quad/drone/battery"]),
    );
    expect(missing).toEqual([
      { key: "quad/drone/esc", label: "esc", matchedTags: ["power"] },
    ]);
  });

  it("matches any of the include tags and sorts by key", () => {
    const missing = missingFilteredComponents(
      components,
      keys,
      0,
      ["video", "motor"],
      new Set(),
    );
    expect(missing.map((m) => m.key)).toEqual([
      "quad/drone/camera",
      "quad/drone/esc",
    ]);
  });

  it("ignores other systems and bare definitions", () => {
    const missing = missingFilteredComponents(
      components,
      keys,
      0,
      ["power"],
      new Set(["quad/drone/battery", "quad/drone/esc"]),
    );
    expect(missing).toEqual([]);
  });
});

describe("addFilterTag / removeFilterTag", () => {
  it("adds a trimmed tag", () => {
    expect(addFilterTag(["power"], " video ")).toEqual(["power", "video"]);
  });

  it("ignores empty, duplicate and multi-word input", () => {
    expect(addFilterTag(["power"], "   ")).toEqual(["power"]);
    expect(addFilterTag(["power"], "power")).toEqual(["power"]);
    expect(addFilterTag(["power"], "two words")).toEqual(["power"]);
  });

  it("removes a tag", () => {
    expect(removeFilterTag(["power", "video"], "power")).toEqual(["video"]);
  });
});
