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

    await workspace.dispatch({
      type: "move-node",
      component: key,
      x: 120,
      y: -40,
    });
    expect(workspace.layoutPosition(key)).toEqual({ x: 120, y: -40 });
    expect(workspace.selectedComponentKey).toBe(key);

    await workspace.dispatch({ type: "add-diagram-view", name: "detail" });
    expect(workspace.activeDiagram).toBe("detail");
    expect(workspace.selectedComponentKey).toBe(key);
    workspace.assertInvariants();
  });

  it("resolves selection by qualified component key", async () => {
    const workspace = await WorkspaceHarness.fromExample("software-house");
    const key = workspace.componentKeys[0];
    if (!key) throw new Error("software-house has no components");

    workspace.selectComponent(key);

    expect(workspace.selectedComponentKey).toBe(key);
    expect(workspace.selectedIndex).toBe(0);
  });

  it("undoes a created component's HCL and canvas placement together", async () => {
    const workspace = await WorkspaceHarness.empty();
    const before = workspace.snapshot().canonicalHcl;

    await workspace.dispatch({
      type: "create-component",
      label: "sensor",
    });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).toContain('component "sensor"');
    const createdKey = workspace.componentKeys.find((key) =>
      key.endsWith("/sensor")
    );
    if (!createdKey) throw new Error("created sensor not found");
    expect(workspace.layoutPosition(createdKey)).toEqual({
      x: 100,
      y: 100,
    });
    expect(workspace.canUndo).toBe(true);

    await workspace.dispatch({ type: "undo" });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).toBe(before);
    expect(workspace.layoutPosition(createdKey)).toBeUndefined();

    await workspace.dispatch({ type: "redo" });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).toContain('component "sensor"');
    const restoredKey = workspace.componentKeys.find((key) =>
      key.endsWith("/sensor")
    );
    if (!restoredKey) throw new Error("redone sensor not found");
    expect(workspace.layoutPosition(restoredKey)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("undoes a delete, restoring scope and label", async () => {
    const workspace = await WorkspaceHarness.empty();
    await workspace.dispatch({
      type: "create-component",
      label: "cpu",
    });
    const createdKey = workspace.componentKeys.find((key) =>
      key.endsWith("/cpu")
    );
    if (!createdKey) throw new Error("created cpu not found");
    const withCpu = workspace.snapshot().canonicalHcl;

    await workspace.dispatch({
      type: "delete-component",
      component: createdKey,
    });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).not.toContain(
      'instance "cpu"',
    );

    await workspace.dispatch({ type: "undo" });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).toBe(withCpu);

    await workspace.dispatch({ type: "redo" });
    workspace.assertInvariants();
    expect(workspace.snapshot().canonicalHcl).not.toContain(
      'instance "cpu"',
    );
  });

  it("keeps drag/resize undo working alongside model transactions", async () => {
    const workspace = await WorkspaceHarness.fromExample("drone");
    const key = workspace.componentKeys.find((candidate) =>
      candidate.endsWith("/flight-controller")
    );
    if (!key) throw new Error("drone flight controller not found");

    await workspace.dispatch({
      type: "move-node",
      component: key,
      x: 120,
      y: -40,
    });
    expect(workspace.layoutPosition(key)).toEqual({ x: 120, y: -40 });

    await workspace.dispatch({ type: "undo" });
    expect(workspace.layoutPosition(key)).toBeUndefined();
    workspace.assertInvariants();

    await workspace.dispatch({ type: "redo" });
    expect(workspace.layoutPosition(key)).toEqual({ x: 120, y: -40 });
    workspace.assertInvariants();
  });
});
