import { describe, expect, it } from "vitest";
import type { Dirent } from "../../../../vfs/fs";
import type { StoredBox } from "./persistence";
import {
  layoutFromSelection,
  viewPathFromName,
  viewPathTaken,
} from "./viewFromSelection";

function file(path: string): Dirent {
  return {
    name: path.split("/").pop() ?? path,
    path,
    isFile: () => true,
    isDirectory: () => false,
  };
}

function directory(path: string): Dirent {
  return {
    name: path.split("/").pop() ?? path,
    path,
    isFile: () => false,
    isDirectory: () => true,
  };
}

const CHECKED: Record<string, StoredBox> = {
  "main/mcu": { x: 10, y: 20, width: 120, height: 80, textAlign: "top-left" },
  "main/imu": { x: 200, y: 20 },
  "main/radio": { x: 400, y: 20 },
};

describe("viewPathFromName", () => {
  it("appends the .hcl extension", () => {
    expect(viewPathFromName("overview")).toBe("overview.hcl");
  });

  it("leaves an explicit extension alone rather than doubling it", () => {
    expect(viewPathFromName("overview.hcl")).toBe("overview.hcl");
  });

  it("trims surrounding whitespace", () => {
    expect(viewPathFromName("  overview  ")).toBe("overview.hcl");
  });

  it("rejects a blank name", () => {
    expect(viewPathFromName("   ")).toBeNull();
  });

  it("rejects a nested path — a name is one path segment", () => {
    expect(viewPathFromName("sub/overview")).toBeNull();
  });
});

describe("viewPathTaken", () => {
  it("is true when a view file already sits at that path", () => {
    expect(
      viewPathTaken([file("main.hcl"), file("overview.hcl")], "overview.hcl"),
    )
      .toBe(true);
  });

  it("is false for a different view", () => {
    expect(viewPathTaken([file("main.hcl")], "overview.hcl")).toBe(false);
  });

  it("is false for a directory of the same name", () => {
    // `views/overview/` is a folder, so `views/overview.hcl` is still free.
    expect(viewPathTaken([directory("overview")], "overview.hcl")).toBe(false);
  });
});

describe("layoutFromSelection", () => {
  it("places only the selected components, at the boxes they have here", () => {
    // One assertion on the whole record, because "just the selection" and
    // "carrying size and alignment over" are the same claim: a node that came
    // across with only its position would differ here too.
    const layout = layoutFromSelection(
      "main",
      CHECKED,
      ["main/mcu", "main/imu"],
    );
    expect(layout.checked).toEqual({
      "main/mcu": {
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        textAlign: "top-left",
      },
      "main/imu": { x: 200, y: 20 },
    });
  });

  it("does not alias the boxes it copies — later edits stay in this view", () => {
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu"]);
    const copied = layout.checked["main/mcu"];
    if (!copied) throw new Error("the selected component was not copied");
    copied.x = 999;
    expect(CHECKED["main/mcu"]?.x).toBe(10);
  });

  it("skips a selected key that has no box on the canvas", () => {
    // A key can outlive its component (renamed away, reparented); the new
    // view must not gain a node the model can't resolve.
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu", "gone"]);
    expect(Object.keys(layout.checked)).toEqual(["main/mcu"]);
  });

  it("binds to the given system", () => {
    expect(layoutFromSelection("drone", CHECKED, ["main/mcu"]).system)
      .toBe("drone");
  });

  it("brings none of the old view's annotations or connection overrides", () => {
    const layout = layoutFromSelection("main", CHECKED, ["main/mcu"]);
    expect(layout.annotations).toEqual([]);
    expect(layout.connections).toEqual({});
  });
});
