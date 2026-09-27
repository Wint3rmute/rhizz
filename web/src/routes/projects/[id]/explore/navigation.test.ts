import { describe, expect, it } from "vitest";
import type { Dirent } from "../../../../vfs/fs";
import { findComponentDiagram, linkedComponentIndexes } from "./navigation";

function file(name: string): Dirent {
  return {
    name,
    path: name,
    isFile: () => true,
    isDirectory: () => false,
  };
}

describe("Explore diagram navigation", () => {
  it("matches a component label to an HCL diagram", () => {
    const engine = file("engine.hcl");
    expect(findComponentDiagram([engine], "engine", "drone/engine")).toBe(
      engine,
    );
  });

  it("prefers an exact qualified component path when available", () => {
    const bare = file("engine.hcl");
    const qualified = file("drone/engine.hcl");
    expect(
      findComponentDiagram([bare, qualified], "engine", "drone/engine"),
    ).toBe(qualified);
  });

  it("returns undefined when no detail diagram exists", () => {
    expect(
      findComponentDiagram([file("overview.hcl")], "engine", "drone/engine"),
    )
      .toBeUndefined();
  });
});

describe("linkedComponentIndexes", () => {
  it("links only components that have a detail diagram", () => {
    const engine = file("engine.hcl");
    const linked = linkedComponentIndexes(
      [{ label: "engine" }, { label: "wing" }],
      ["drone/engine", "drone/wing"],
      [engine],
    );
    expect([...linked]).toEqual([0]);
  });

  it("links via the qualified path when the file name is not the bare label", () => {
    const linked = linkedComponentIndexes(
      [{ label: "engine" }],
      ["drone/engine"],
      [file("drone/engine.hcl")],
    );
    expect([...linked]).toEqual([0]);
  });
});
