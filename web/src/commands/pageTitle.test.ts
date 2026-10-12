import { describe, expect, it } from "vitest";
import { formatPageTitle, pageLabelForPath } from "./pageTitle";

describe("pageLabelForPath", () => {
  it("names each workspace page after the shared workspace list", () => {
    expect(pageLabelForPath("/projects/drone/overview")).toBe("Overview");
    expect(pageLabelForPath("/projects/drone/modeling")).toBe("Modeling");
    expect(pageLabelForPath("/projects/drone/modeling/main.hcl")).toBe(
      "Modeling",
    );
    expect(pageLabelForPath("/projects/drone/inventory")).toBe("Inventory");
    expect(pageLabelForPath("/projects/drone/inventory/battery")).toBe(
      "Inventory",
    );
    expect(pageLabelForPath("/projects/drone/explore")).toBe("Explore");
    expect(pageLabelForPath("/projects/drone/code")).toBe("Code");
  });

  it("returns null off project pages and for unknown segments", () => {
    expect(pageLabelForPath("/projects")).toBeNull();
    expect(pageLabelForPath("/projects/drone")).toBeNull();
    expect(pageLabelForPath("/projects/drone/embed/main.hcl")).toBeNull();
    expect(pageLabelForPath("/projects/drone/nope")).toBeNull();
    expect(pageLabelForPath("/book-example")).toBeNull();
    expect(pageLabelForPath("/")).toBeNull();
  });
});

describe("formatPageTitle", () => {
  it("reads Rhizz: <project> - <page> on workspace pages", () => {
    expect(formatPageTitle("Drone", "Inventory")).toBe(
      "Rhizz: Drone - Inventory",
    );
  });

  it("falls back to the project when the page is unknown", () => {
    expect(formatPageTitle("Drone", null)).toBe("Rhizz: Drone");
  });

  it("falls back to bare Rhizz with no project", () => {
    expect(formatPageTitle(null, null)).toBe("Rhizz");
    expect(formatPageTitle(null, "Inventory")).toBe("Rhizz");
  });
});
