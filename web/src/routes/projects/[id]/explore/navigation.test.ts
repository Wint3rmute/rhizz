import { describe, expect, it } from "vitest";
import type { Dirent } from "../../../../vfs/fs";
import {
  detailViewTarget,
  findComponentDiagram,
  linkedComponentIndexes,
} from "./navigation";

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

describe("detailViewTarget", () => {
  it("jumps to the existing detail diagram, bare label or qualified path", () => {
    expect(
      detailViewTarget([file("engine.hcl")], "engine", "drone/engine"),
    ).toEqual({ kind: "jump", path: "engine.hcl" });
    expect(
      detailViewTarget(
        [file("engine.hcl"), file("drone/engine.hcl")],
        "engine",
        "drone/engine",
      ),
    ).toEqual({ kind: "jump", path: "drone/engine.hcl" });
  });

  it("offers to create the conventional path when none exists", () => {
    expect(
      detailViewTarget([file("overview.hcl")], "engine", "drone/engine"),
    ).toEqual({ kind: "create", path: "engine.hcl" });
  });

  it("creates into a project that has no views at all", () => {
    expect(detailViewTarget([], "engine", "drone/engine")).toEqual({
      kind: "create",
      path: "engine.hcl",
    });
  });

  it("ignores directories and non-HCL files", () => {
    const folder = { ...file("engine"), isFile: () => false };
    expect(
      detailViewTarget([folder, file("engine.png")], "engine", "drone/engine"),
    ).toEqual({ kind: "create", path: "engine.hcl" });
  });
});
