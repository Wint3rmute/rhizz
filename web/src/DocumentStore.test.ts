import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentStore } from "./DocumentStore.svelte";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("DocumentStore", () => {
  it("initializes with default project and derives valid empty systemHcl", () => {
    const doc = new DocumentStore();
    expect(doc.project.name).toBe("untitled");
    expect(doc.systems).toEqual([]);
    expect(doc.systemHcl).toContain(
      'project {\n  name    = "untitled"\n  version = "0.1.0"\n}',
    );
  });

  it("adds system and components and derives valid systemHcl with diagnostics", () => {
    const doc = new DocumentStore();
    doc.setProject("drone-v1", "1.0.0", ["Alice"]);
    const sys = doc.addSystem("drone", "A quadcopter platform");
    expect(sys.label).toBe("drone");

    const fc = doc.addComponent("drone", "flight-controller", false);
    expect(fc).toBeDefined();
    expect(fc?.label).toBe("flight-controller");

    const mcu = doc.addComponent("drone/flight-controller", "mcu", true);
    expect(mcu).toBeDefined();
    expect(mcu?.leaf).toBe(true);

    const hcl = doc.systemHcl;
    expect(hcl).toContain('system "drone"');
    expect(hcl).toContain('component "flight-controller"');
    expect(hcl).toContain('component "mcu"');
    expect(hcl).toContain("leaf        = true");

    // Compilation diagnostics should be available
    expect(doc.compileResult.error_count()).toBe(0);
    const model = doc.model;
    expect(model).toBeDefined();
    expect(model?.components()).toHaveLength(2);
  });

  it("automatically clears leaf flag on parent when adding a child component", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    const parent = doc.addComponent("demo", "parent-comp", true);
    expect(parent?.leaf).toBe(true);
    expect(doc.systemHcl).toContain("leaf        = true");

    const child = doc.addComponent("demo/parent-comp", "child-comp", true);
    expect(child?.leaf).toBe(true);
    expect(parent?.leaf).toBe(false);

    expect(doc.findComponent("demo/parent-comp")?.leaf).toBe(false);
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("supports adding protocols, ports, messages, and fields and updating completion score", () => {
    const doc = new DocumentStore();
    const proto = doc.addProtocol("spi", "SPI protocol");
    proto.messages.push({
      label: "data",
      description: "Sensor data",
      fields: [
        { label: "x", type: "float32", unit: "g", required: true },
        { label: "y", type: "float32", unit: "g", required: true },
      ],
    });

    doc.addSystem("demo");
    doc.addComponent("demo", "sensor", true);
    doc.updateComponent("demo/sensor", { description: "IMU sensor" });

    const port = doc.addPort("demo/sensor", "spi", "spi", "provider", true);
    expect(port).toBeDefined();
    expect(port?.protocol).toBe("spi");
    expect(port?.external).toBe(true);

    const hcl = doc.systemHcl;
    expect(hcl).toContain('protocol "spi"');
    expect(hcl).toContain('message "data"');
    expect(hcl).toContain('field "x"');
    expect(hcl).toContain('unit        = "g"');
    expect(hcl).toContain('port "spi"');
    expect(hcl).toContain('protocol    = "spi"');
    expect(hcl).toContain('role        = "provider"');
    expect(hcl).toContain("external    = true");

    expect(doc.compileResult.error_count()).toBe(0);
    const score = doc.score;
    expect(score).toBeDefined();
    expect(score?.overall_percentage).toBeGreaterThan(0);
  });

  it("supports reparenting components", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    doc.addComponent("demo", "subsys", false);
    doc.addComponent("demo", "sensor", true);

    expect(doc.findComponent("demo/sensor")).toBeDefined();

    const success = doc.reparentComponent("demo/sensor", "demo/subsys");
    expect(success).toBe(true);

    expect(doc.findComponent("demo/sensor")).toBeNull();
    expect(doc.findComponent("demo/subsys/sensor")).toBeDefined();
    expect(doc.systemHcl).toContain(
      'component "subsys" {\n\n    component "sensor"',
    );
  });

  it("rejects reparenting into own descendant or creating duplicate label", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    doc.addComponent("demo", "parent", false);
    doc.addComponent("demo/parent", "child", false);
    doc.addComponent("demo/parent/child", "grandchild", true);

    // Reject cycle: cannot reparent parent into its own grandchild
    expect(
      doc.reparentComponent("demo/parent", "demo/parent/child/grandchild"),
    ).toBe(false);

    // Reject self-reparenting
    expect(doc.reparentComponent("demo/parent", "demo/parent")).toBe(false);

    // Reject duplicate label collision
    expect(doc.addComponent("demo", "dup", true)).toBeDefined();
    expect(doc.addComponent("demo/parent", "dup", true)).toBeDefined();
    expect(doc.reparentComponent("demo/dup", "demo/parent")).toBe(false);
  });

  it("supports deleting components and connections", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    doc.addComponent("demo", "compA", true);
    doc.addComponent("demo", "compB", true);
    doc.addConnection("demo", { label: "link", from: "compA", to: "compB" });

    expect(doc.systemHcl).toContain('connection "link"');
    expect(doc.deleteConnection("demo", "link")).toBe(true);
    expect(doc.systemHcl).not.toContain('connection "link"');

    expect(doc.deleteComponent("demo/compA")).toBe(true);
    expect(doc.systemHcl).not.toContain('component "compA"');
  });

  it("manages views and layout coordinates cleanly in viewsHcl", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    doc.addView("main", "demo", "Main view");

    doc.updateNodeLayout("main", "demo/compA", {
      x: 100,
      y: 200,
      width: 150,
      height: 90,
      text_align: "center",
    });

    const viewsHcl = doc.viewsHcl;
    expect(viewsHcl).toContain('view "main"');
    expect(viewsHcl).toContain('node "demo/compA"');
    expect(viewsHcl).toContain("x          = 100");
    expect(viewsHcl).toContain("y          = 200");
    expect(viewsHcl).toContain("width      = 150");

    // Core systemHcl should NOT have any layout coordinates
    expect(doc.systemHcl).not.toContain("node ");
    expect(doc.systemHcl).not.toContain("x          =");
  });

  it("loads from existing HCL files (loadFromHcl)", () => {
    const systemHcl = `project {
  name    = "robot-arm"
  version = "2.0.0"
  authors = ["RoboCorp"]
}

system "arm" {
  description = "6-DOF manipulator"

  component "gripper" {
    description = "Pneumatic end-effector"
    leaf        = true

    port "ctrl" {
      protocol = "can"
      role     = "consumer"
    }
  }

  component "base" {
    description = "Motor controller"
    leaf        = true

    port "ctrl-out" {
      protocol = "can"
      role     = "provider"
    }
  }

  connection "can-bus" {
    description = "CAN link"
    from        = "base/ctrl-out"
    to          = "gripper/ctrl"
  }
}
`;

    const viewsHcl = `view "wiring" {
  description = "Bus wiring"
  system      = "arm"

  node "arm/gripper" {
    x     = 400
    y     = 100
    width = 120
  }
}
`;

    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl, viewsHcl);

    expect(doc.project.name).toBe("robot-arm");
    expect(doc.systems).toHaveLength(1);
    expect(doc.systems[0].label).toBe("arm");
    expect(doc.systems[0].components).toHaveLength(2);
    expect(doc.systems[0].connections).toHaveLength(1);

    expect(doc.views).toHaveLength(1);
    expect(doc.views[0].label).toBe("wiring");
    expect(doc.views[0].nodes?.[0].component).toBe("arm/gripper");
    expect(doc.views[0].nodes?.[0].x).toBe(400);

    // Roundtrip verification
    expect(doc.systemHcl).toContain('system "arm"');
    expect(doc.systemHcl).toContain('connection "can-bus"');
    expect(doc.viewsHcl).toContain('view "wiring"');
  });

  it("preserves UNIX path notation in connections after loading and editing (no colon regression)", () => {
    const systemHcl = `system "demo" {
  component "sensor" {
    leaf = true
    port "out" {
      role = "provider"
    }
  }

  component "actuator" {
    leaf = true
    port "in" {
      role = "consumer"
    }
  }

  connection "link" {
    from = "sensor/out"
    to   = "actuator/in"
  }
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    // Edit a component in the diagram (e.g. update description)
    doc.updateComponent("demo/sensor", {
      description: "Updated sensor description",
    });

    // Verify generated HCL contains UNIX path ("sensor/out", NOT "sensor:out")
    expect(doc.systemHcl).toContain('from         = "sensor/out"');
    expect(doc.systemHcl).toContain('to           = "actuator/in"');
    expect(doc.systemHcl).not.toContain("sensor:out");
    expect(doc.systemHcl).not.toContain("actuator:in");

    // Verify round-trip compilation produces 0 errors
    expect(doc.compileResult.error_count()).toBe(0);
  });
});
