import { describe, expect, it } from "vitest";
import {
  createPaletteIndex,
  paletteRows,
} from "../components/palette/commandPalette";
import { actionItems, ACTIONS_GROUP } from "./actionItems";

// Row actions reach into the navbar (settings) and ThemeState (theme),
// which the unit under test must not touch — the callbacks stand in, so
// what is asserted is what gets offered and what each row says, not what
// opening settings or toggling the theme does.
const rows = () =>
  actionItems({ onOpenSettings: () => {}, onToggleTheme: () => {} });

describe("actionItems", () => {
  it("offers open-settings and toggle-theme", () => {
    expect(rows().map((i) => i.id)).toEqual([
      "command:open-settings",
      "command:toggle-theme",
    ]);
    expect(rows().map((i) => i.label)).toEqual([
      "Open settings",
      "Toggle theme",
    ]);
  });

  it("puts them both in one new group", () => {
    expect(new Set(rows().map((i) => i.group))).toEqual(
      new Set([ACTIONS_GROUP]),
    );
    expect(ACTIONS_GROUP).toBe("Actions");
  });

  it("gives every row a distinct id, since the list is keyed on it", () => {
    const ids = rows().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has every row able to act, so no choice is a dead end", () => {
    for (const item of rows()) {
      expect(item.action).toBeTypeOf("function");
    }
  });

  it("calls back with the right action", () => {
    let opened = 0;
    let toggled = 0;
    for (const item of actionItems({
      onOpenSettings: () => (opened += 1),
      onToggleTheme: () => (toggled += 1),
    })) {
      item.action?.();
    }
    expect(opened).toBe(1);
    expect(toggled).toBe(1);
  });

  it("invokes only its own callback", () => {
    let opened = 0;
    let toggled = 0;
    const items = actionItems({
      onOpenSettings: () => (opened += 1),
      onToggleTheme: () => (toggled += 1),
    });
    items.find((i) => i.id === "command:open-settings")?.action?.();
    expect(opened).toBe(1);
    expect(toggled).toBe(0);
  });

  it("makes settings searchable by its synonym", () => {
    const found = paletteRows(createPaletteIndex(rows()), "preferences").map(
      (r) => r.item.id,
    );
    expect(found).toContain("command:open-settings");
  });

  it("makes theme searchable by mode and synonym", () => {
    for (const query of ["theme", "dark", "light", "appearance"]) {
      const found = paletteRows(createPaletteIndex(rows()), query).map(
        (r) => r.item.id,
      );
      expect(found, `${query} must find toggle-theme`).toContain(
        "command:toggle-theme",
      );
    }
  });
});
