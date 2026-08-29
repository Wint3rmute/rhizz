import { describe, expect, it } from "vitest";
import { WorkspaceHarness } from "./WorkspaceHarness";

describe("WorkspaceHarness", () => {
  for (const example of ["drone", "software-house", "apollo-11"] as const) {
    it(`loads ${example} through the project VFS and compiler`, async () => {
      const workspace = await WorkspaceHarness.fromExample(example);

      expect(workspace.blockingErrorCodes()).toEqual([]);
      expect(workspace.componentKeys.length).toBeGreaterThan(0);
      expect(workspace.snapshot().canonicalHcl).not.toBe("");
    });
  }

  it("loads an empty project without model components", async () => {
    const workspace = await WorkspaceHarness.empty();

    expect(workspace.blockingErrorCodes()).toEqual([]);
    expect(workspace.componentKeys).toEqual([]);
  });

  it("resolves selection by qualified component key", async () => {
    const workspace = await WorkspaceHarness.fromExample("software-house");
    const key = workspace.componentKeys[0];
    if (!key) throw new Error("software-house has no components");

    workspace.selectComponent(key);

    expect(workspace.selectedComponentKey).toBe(key);
    expect(workspace.selectedIndex).toBe(0);
  });
});
