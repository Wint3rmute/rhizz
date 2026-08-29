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

  for (const example of ["drone", "software-house", "apollo-11"] as const) {
    it(`round-trips ${example} through canonical HCL`, async () => {
      const workspace = await WorkspaceHarness.fromExample(example);

      expect(workspace.roundTripSnapshot()).toEqual(workspace.snapshot());
    });
  }

  it("preserves selected logical identity across the first software-house visual edit", async () => {
    const workspace = await WorkspaceHarness.fromExample("software-house");
    const selectedKey = "acme-software/engineering/frontend-team";
    workspace.selectComponent(selectedKey);

    await workspace.setSelectedComponentVisuals({ color: "primary" });
    expect(workspace.selectedComponentKey).toBe(selectedKey);

    await workspace.setSelectedComponentVisuals({ border: "dotted" });
    expect(workspace.selectedComponentKey).toBe(selectedKey);
  });

  it("dispatches deterministic actions and checks workspace invariants", async () => {
    const workspace = await WorkspaceHarness.fromExample("drone");
    const key = workspace.componentKeys.find((candidate) =>
      candidate.endsWith("/flight-controller")
    );
    if (!key) throw new Error("drone flight controller not found");

    await workspace.dispatch({ type: "select-component", component: key });
    await workspace.dispatch({
      type: "set-node-visuals",
      component: key,
      color: "primary",
      border: "dashed",
    });

    workspace.assertInvariants();
    expect(workspace.selectedComponentKey).toBe(key);
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
