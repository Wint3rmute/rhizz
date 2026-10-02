import { describe, expect, it } from "vitest";
import { commandItems, NAVIGATE_GROUP } from "./commandItems";
import { WORKSPACE_PAGES } from "./workspacePages";

// Row actions are navigation, which is the host's job — the unit under test
// is what gets offered and what each row says, not where it goes.
const rows = () => commandItems(() => {});

describe("commandItems", () => {
  it("offers every workspace page, in navbar order", () => {
    expect(rows().map((i) => i.label)).toEqual([
      "Go to Overview",
      "Go to Modeling",
      "Go to Inventory",
      "Go to Explore",
      "Go to Code",
    ]);
  });

  it("names the pages after the shared workspace list, so the two cannot drift", () => {
    expect(rows().map((i) => i.label)).toEqual(
      WORKSPACE_PAGES.map((p) => `Go to ${p.label}`),
    );
    expect(rows().map((i) => i.icon)).toEqual(
      WORKSPACE_PAGES.map((p) => p.icon),
    );
  });

  it("puts them all in one group", () => {
    expect(new Set(rows().map((i) => i.group))).toEqual(
      new Set([NAVIGATE_GROUP]),
    );
  });

  it("offers no view rows — the files carry them", () => {
    // A view used to have a second row here, folder-qualified and opening
    // the canvas. Now it has exactly one row, from the file listing, which
    // opens the canvas too — so this list is pages only. Matched on the id
    // prefix, not the substring "view", which "overview" also contains.
    expect(rows().every((i) => i.group === NAVIGATE_GROUP)).toBe(true);
    expect(
      rows()
        .map((i) => i.id)
        .filter((id) => id.startsWith("command:view:")),
    ).toEqual([]);
  });

  it("gives every row a distinct id, since the list is keyed on it", () => {
    const ids = rows().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes a page row searchable by the bare page name", () => {
    expect(rows().find((i) => i.label === "Go to Inventory")?.hint).toContain(
      "Inventory",
    );
  });

  it("has every row able to act, so no choice is a dead end", () => {
    for (const item of rows()) {
      expect(item.action).toBeTypeOf("function");
    }
  });

  it("calls the host back with the page id", () => {
    const seen: string[] = [];
    for (const item of commandItems((id) => seen.push(id))) item.action?.();
    expect(seen).toEqual([
      "overview",
      "modeling",
      "inventory",
      "explore",
      "code",
    ]);
  });
});
