import { describe, expect, it } from "vitest";
import {
  type AttributeName,
  ATTRIBUTE_SCOPES,
  componentAttributes,
  scopeFile,
  viewAttributes,
} from "./attributeScope";

describe("attribute scope", () => {
  // The single fact the split is built on: a node's attributes do not all
  // live in the same file. Editing "Text alignment" rewrites the view, while
  // editing "Color" rewrites the model — and the inspector has to say so,
  // because nothing about the two selects looks different.
  it("splits the attributes by the file they are persisted in", () => {
    expect(viewAttributes()).toContain("text_align");
    expect(componentAttributes()).toContain("color");
    expect(componentAttributes()).not.toContain("text_align");
    expect(viewAttributes()).not.toContain("color");
  });

  it("names the file each scope writes to", () => {
    expect(scopeFile("view")).toBe("views/<view>.hcl");
    expect(scopeFile("component")).toBe("system.hcl");
  });

  // Guards against a scope added for one attribute and forgotten for the
  // next: the map is the single source for both lists, so a typo'd key would
  // otherwise silently drop a field out of the inspector entirely.
  it("classifies every attribute exactly once", () => {
    expect([...componentAttributes(), ...viewAttributes()].sort()).toEqual(
      [...Object.keys(ATTRIBUTE_SCOPES)].sort(),
    );
    expect(new Set(Object.values(ATTRIBUTE_SCOPES)).size).toBe(2);
  });

  // The grouping is only useful if it is *stable* — an attribute flipping
  // between scopes would move a field between the two panels on a refactor,
  // which reads as a bug to anyone who learned where to find it.
  it("puts the visual attributes on the component side", () => {
    for (const key of ["icon", "color", "border", "font", "full_name"]) {
      expect(ATTRIBUTE_SCOPES[key as AttributeName]).toBe("component");
    }
  });

  it("puts the geometry attributes on the view side", () => {
    for (const key of ["text_align", "x", "y", "width", "height"]) {
      expect(ATTRIBUTE_SCOPES[key as AttributeName]).toBe("view");
    }
  });
});