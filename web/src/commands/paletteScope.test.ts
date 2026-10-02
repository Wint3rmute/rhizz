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

  it("adds the inventory section on Inventory, alongside the files", () => {
    expect(paletteScopeForPath("/projects/p/inventory")).toEqual({
      files: "all",
      inventory: true,
    });
    expect(paletteScopeForPath("/projects/p/inventory/battery")).toEqual({
      files: "all",
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
      files: "all",
      inventory: true,
    });
  });
});
