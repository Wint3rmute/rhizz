import { describe, expect, it } from "vitest";
import { paletteScopeForPath } from "./paletteScope";

describe("paletteScopeForPath", () => {
  it("offers only diagrams on the pages that draw them", () => {
    // Modeling and Explore are both "which diagram?", so on those pages a
    // file row would be a row that opens text where the user wanted a
    // canvas.
    expect(paletteScopeForPath("/projects/p/modeling")).toEqual({
      files: "views",
      inventory: false,
    });
    expect(paletteScopeForPath("/projects/p/modeling/main.hcl")).toEqual({
      files: "views",
      inventory: false,
    });
    expect(paletteScopeForPath("/projects/p/explore")).toEqual({
      files: "views",
      inventory: false,
    });
  });

  it("offers every file on Code, and no inventory section", () => {
    expect(paletteScopeForPath("/projects/p/code")).toEqual({
      files: "all",
      inventory: false,
    });
  });

  it("offers the definitions but no files on Inventory", () => {
    // Inventory is a page about entities, and both of its answers — the pages
    // and the model's own definitions — are in the list already. A file row
    // there is a third thing to search that the page is not about, and it
    // sends the user off to the editor to get it.
    expect(paletteScopeForPath("/projects/p/inventory")).toEqual({
      files: "none",
      inventory: true,
    });
    expect(paletteScopeForPath("/projects/p/inventory/battery")).toEqual({
      files: "none",
      inventory: true,
    });
  });

  it("falls back to every file on pages that are about neither", () => {
    expect(paletteScopeForPath("/projects/p/overview")).toEqual({
      files: "all",
      inventory: false,
    });
    expect(paletteScopeForPath("/projects")).toEqual({
      files: "all",
      inventory: false,
    });
    expect(paletteScopeForPath("/")).toEqual({
      files: "all",
      inventory: false,
    });
  });

  it("never offers the inventory section outside the inventory page", () => {
    for (
      const path of [
        "/projects/p/code",
        "/projects/p/modeling",
        "/projects/p/explore",
        "/projects/p/overview",
        "/projects/p/embed/main.hcl",
        "/",
      ]
    ) {
      expect(
        paletteScopeForPath(path).inventory,
        `${path} must not offer inventory rows`,
      ).toBe(false);
    }
  });

  it("does not mistake a project id for a subpage", () => {
    // A project is addressed by the slug of its name, so `/projects/explore`
    // is a project called "explore" — with no subpage at all.
    expect(paletteScopeForPath("/projects/explore")).toEqual({
      files: "all",
      inventory: false,
    });
    expect(paletteScopeForPath("/projects/p/inventory/explore")).toEqual({
      files: "none",
      inventory: true,
    });
  });
});
