import { describe, expect, it } from "vitest";
import { NAVIGATE_GROUP, paletteCommands, VIEWS_GROUP } from "./commandItems";
import { WORKSPACE_PAGES } from "./workspacePages";

// Row actions are navigation, which is the host's job — the unit under test
// is what gets offered and what each row says, not where it goes.
const NOOP = { onPage: () => {}, onView: () => {} };
const rows = (views: readonly string[] = []) => paletteCommands(views, NOOP);

describe("paletteCommands", () => {
  it("offers every workspace page, in navbar order", () => {
    const items = rows();
    expect(items.slice(0, WORKSPACE_PAGES.length).map((i) => i.label)).toEqual([
      "Go to Overview",
      "Go to Modeling",
      "Go to Inventory",
      "Go to Explore",
      "Go to Code",
    ]);
  });

  it("names the pages after the shared workspace list, so the two cannot drift", () => {
    const pageItems = rows().filter((i) => i.group !== VIEWS_GROUP);
    expect(pageItems.map((i) => i.label)).toEqual(
      WORKSPACE_PAGES.map((p) => `Go to ${p.label}`),
    );
    expect(pageItems.map((i) => i.icon)).toEqual(
      WORKSPACE_PAGES.map((p) => p.icon),
    );
  });

  it("groups the page jumps apart from the views", () => {
    expect(new Set(rows().map((i) => i.group))).toEqual(
      new Set([NAVIGATE_GROUP]),
    );
  });

  it("offers a row per view, labelled without the views/ folder", () => {
    const viewItems = rows(["main.hcl", "drone/engine.hcl"]).filter(
      (i) => i.group === VIEWS_GROUP,
    );
    expect(viewItems.map((i) => i.label)).toEqual([
      "drone/engine.hcl",
      "main.hcl",
    ]);
    expect(viewItems.map((i) => i.id)).toEqual([
      "command:view:drone/engine.hcl",
      "command:view:main.hcl",
    ]);
  });

  it("keeps the page rows ahead of the views", () => {
    const items = rows(["main.hcl"]);
    expect(items[WORKSPACE_PAGES.length]?.group).toBe(VIEWS_GROUP);
  });

  it('says where a view lives, so typing "views" finds them', () => {
    const item = rows(["main.hcl"])[WORKSPACE_PAGES.length];
    expect(item?.detail).toBe("views");
    expect(item?.hint).toContain("view");
  });

  it("makes a page row searchable by the bare page name", () => {
    const inventory = rows().find((i) => i.label === "Go to Inventory");
    expect(inventory?.hint).toContain("Inventory");
  });

  it("gives every row a distinct id, since the list is keyed on it", () => {
    const ids = rows(["main.hcl", "drone/engine.hcl"]).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has every row able to act, so no choice is a dead end", () => {
    for (const item of rows(["main.hcl"])) {
      expect(item.action).toBeTypeOf("function");
    }
  });

  it("calls the host's callbacks with the page id and the view path", () => {
    const seen: string[] = [];
    const items = paletteCommands(["main.hcl"], {
      onPage: (id) => seen.push(`page:${id}`),
      onView: (view) => seen.push(`view:${view}`),
    });
    for (const item of items) item.action?.();
    expect(seen).toEqual([
      "page:overview",
      "page:modeling",
      "page:inventory",
      "page:explore",
      "page:code",
      "view:main.hcl",
    ]);
  });
});
