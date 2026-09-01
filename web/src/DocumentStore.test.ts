import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentStore, subscribeToMutations } from "./DocumentStore.svelte";

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

  it("adds systems, definitions, and instances and derives valid systemHcl", () => {
    const doc = new DocumentStore();
    doc.setProject("drone-v1", "1.0.0", ["Alice"]);

    const fc = doc.addComponentDefinition("flight-controller");
    expect(fc).toBeDefined();
    expect(fc?.label).toBe("flight-controller");
    expect(fc?.isDefinition).toBe(true);

    const mcu = doc.addComponentDefinition("mcu", { leaf: true });
    expect(mcu).toBeDefined();
    expect(mcu?.leaf).toBe(true);

    const sys = doc.addSystem("drone", "A quadcopter platform");
    expect(sys.label).toBe("drone");

    const inst = doc.addInstance(
      "drone",
      "flight-controller",
      "flight-controller",
    );
    expect(inst).toBeDefined();
    expect(inst?.source).toBe("flight-controller");
    expect(inst?.isDefinition).toBe(false);

    const hcl = doc.systemHcl;
    expect(hcl).toContain('system "drone"');
    expect(hcl).toContain('component "flight-controller" {');
    expect(hcl).toContain(
      'instance "flight-controller" {\n    source = "flight-controller"',
    );
    expect(hcl).toContain('component "mcu" {');
    expect(hcl).toContain("leaf        = true");

    // Compilation diagnostics should be available.
    expect(doc.compileResult.error_count()).toBe(0);
    const model = doc.model;
    expect(model).toBeDefined();
    // Two definitions + a system instance.
    expect(model?.components()).toHaveLength(3);
    expect(doc.definitions).toHaveLength(2);
  });

  it("automatically clears leaf flag on parent definition when adding an instance child", () => {
    const doc = new DocumentStore();
    const parent = doc.addComponentDefinition("parent-comp", { leaf: true });
    expect(parent?.leaf).toBe(true);
    expect(doc.systemHcl).toContain("leaf        = true");

    doc.addComponentDefinition("child-comp", { leaf: true });
    const childInst = doc.addInstance(
      "parent-comp",
      "child-comp",
      "child-comp",
    );
    // An instance does not carry its own body/leaf flag (it clones the
    // definition) — but the parent's leaf is cleared once it gains a child.
    expect(childInst?.leaf).toBe(false);
    expect(parent?.leaf).toBe(false);

    expect(doc.findComponent("parent-comp")?.leaf).toBe(false);
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

    doc.addComponentDefinition("sensor", { leaf: true });
    doc.updateComponent("sensor", { description: "IMU sensor" });

    const port = doc.addPort("sensor", "spi", "spi", "provider", true);
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

  it("supports reparenting instances", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("subsys");
    doc.addComponentDefinition("sensor", { leaf: true });
    doc.addSystem("demo");
    doc.addInstance("demo", "subsys", "subsys");
    doc.addInstance("demo", "sensor", "sensor");

    expect(doc.findComponent("demo/sensor")).toBeDefined();

    const success = doc.reparentComponent("demo/sensor", "demo/subsys");
    expect(success).toBe(true);

    expect(doc.findComponent("demo/sensor")).toBeNull();
    expect(doc.findComponent("demo/subsys/sensor")).toBeDefined();
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("rejects reparenting into own descendant or creating duplicate label", () => {
    const doc = new DocumentStore();
    doc.addSystem("demo");
    doc.addComponentDefinition("parent");
    doc.addComponentDefinition("child");
    doc.addComponentDefinition("grandchild", { leaf: true });
    doc.addComponentDefinition("dup", { leaf: true });
    doc.addInstance("demo", "parent", "parent");
    doc.addInstance("demo/parent", "child", "child");
    doc.addInstance("demo/parent/child", "grandchild", "grandchild");

    // Reject cycle: cannot reparent parent into its own grandchild
    expect(
      doc.reparentComponent("demo/parent", "demo/parent/child/grandchild"),
    ).toBe(false);

    // Reject self-reparenting
    expect(doc.reparentComponent("demo/parent", "demo/parent")).toBe(false);

    // Reject duplicate label collision
    expect(doc.addInstance("demo", "dup", "dup")).toBeDefined();
    expect(doc.addInstance("demo/parent", "dup", "dup")).toBeDefined();
    expect(doc.reparentComponent("demo/dup", "demo/parent")).toBe(false);
  });

  it("supports deleting instances and connections", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("compA", { leaf: true });
    doc.addComponentDefinition("compB", { leaf: true });
    doc.addSystem("demo");
    doc.addInstance("demo", "compA", "compA");
    doc.addInstance("demo", "compB", "compB");
    doc.addConnection("demo", { label: "link", from: "compA", to: "compB" });

    expect(doc.systemHcl).toContain('connection "link"');
    expect(doc.deleteConnection("demo", "link")).toBe(true);
    expect(doc.systemHcl).not.toContain('connection "link"');

    expect(doc.deleteComponent("demo/compA")).toBe(true);
    expect(doc.systemHcl).not.toContain('instance "compA"');
  });

  it("deletes top-level definitions by bare label", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("unused", { leaf: true });
    expect(doc.definitions).toHaveLength(1);
    expect(doc.deleteComponent("unused")).toBe(true);
    expect(doc.definitions).toHaveLength(0);
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

system "arm" {
  description = "6-DOF manipulator"

  instance "gripper" {
    source = "gripper"
  }

  instance "base" {
    source = "base"
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
    expect(doc.systems[0]?.label).toBe("arm");
    expect(doc.systems[0]?.components).toHaveLength(2);
    expect(doc.systems[0]?.connections).toHaveLength(1);
    expect(doc.definitions).toHaveLength(2);

    expect(doc.views).toHaveLength(1);
    expect(doc.views[0]?.label).toBe("wiring");
    expect(doc.views[0]?.nodes?.[0]?.component).toBe("arm/gripper");
    expect(doc.views[0]?.nodes?.[0]?.x).toBe(400);

    // Roundtrip verification
    expect(doc.systemHcl).toContain('system "arm"');
    expect(doc.systemHcl).toContain('connection "can-bus"');
    expect(doc.viewsHcl).toContain('view "wiring"');
  });

  it("preserves UNIX path notation in connections after loading and editing (no colon regression)", () => {
    const systemHcl = `component "sensor" {
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

  system "demo" {
    instance "sensor" {
      source = "sensor"
    }
    instance "actuator" {
      source = "actuator"
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
    doc.updateComponent("sensor", {
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

  it("preserves lowercase protocol roles during HCL -> model -> HCL roundtrip without E009 error", () => {
    const systemHcl = `protocol "i2c" {
  description = "I2C bus"
  roles       = ["provider", "consumer"]
}

component "sensor" {
  leaf = true
  port "data" {
    protocol = "i2c"
    role     = "provider"
  }
}

component "mcu" {
  leaf = true
  port "data-in" {
    protocol = "i2c"
    role     = "consumer"
  }
}

system "demo" {
  instance "sensor" {
    source = "sensor"
  }
  instance "mcu" {
    source = "mcu"
  }
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    // Add a connection (triggers HCL serialization and re-compilation)
    doc.addConnection("demo", {
      label: "bus-link",
      from: "sensor/data",
      to: "mcu/data-in",
    });

    // Verify HCL contains lowercase roles
    expect(doc.systemHcl).toContain('roles       = ["provider", "consumer"]');
    expect(doc.systemHcl).not.toContain('"Provider"');
    expect(doc.systemHcl).not.toContain('"Consumer"');

    // Verify round-trip compilation produces 0 errors (no E009)
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("round-trips component visual attributes (color, border, font)", () => {
    const systemHcl = `component "danger" {
  color  = "#ff0000"
  border = "dashed"
  font   = "bold"
}

component "plain" {
  leaf = true
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    const comp = doc.findComponent("danger");
    expect(comp).toBeDefined();
    expect(comp?.color).toBe("#ff0000");
    expect(comp?.border).toBe("dashed");
    expect(comp?.font).toBe("bold");

    // Serialized HCL preserves the attributes and omits defaults.
    expect(doc.systemHcl).toContain('color       = "#ff0000"');
    expect(doc.systemHcl).toContain('border      = "dashed"');
    expect(doc.systemHcl).toContain('font        = "bold"');
    expect(doc.systemHcl).not.toContain('border      = "solid"');

    // A bare definition exposes no visual attributes.
    const plain = doc.findComponent("plain");
    expect(plain?.color).toBeFalsy();
    expect(plain?.border).toBeFalsy();
    expect(plain?.font).toBeFalsy();
  });

  it("persists visual attributes set via updateComponent (inspector path)", () => {
    const systemHcl = `component "compA" {
  leaf = true
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);
    doc.updateComponent("compA", {
      color: "#00ff00",
      border: "dotted",
      font: "italic",
    });

    expect(doc.systemHcl).toContain('color       = "#00ff00"');
    expect(doc.systemHcl).toContain('border      = "dotted"');
    expect(doc.systemHcl).toContain('font        = "italic"');

    doc.updateComponent("compA", {
      color: undefined,
      border: undefined,
      font: undefined,
    });

    expect(doc.systemHcl).not.toContain("color       =");
    expect(doc.systemHcl).not.toContain("border      =");
    expect(doc.systemHcl).not.toContain("font        =");
  });

  it("loads components across multi-file sources and finds them by persistence key", () => {
    const sources = [
      {
        filename: "project.hcl",
        content: `project { name = "apollo-11" }
component "cm" {
    description = "Command module"
    leaf = true
  }
system "apollo-11" {
  instance "cm" {
    source = "cm"
  }
}
`,
      },
      {
        filename: "diagrams/main.hcl",
        content: `view "main" {
  system = "apollo-11"
  node "apollo-11/cm" {
    x = 100
    y = 200
  }
}
`,
      },
    ];

    const doc = new DocumentStore();
    doc.loadFromSources(sources);

    expect(doc.systems).toHaveLength(1);
    expect(doc.systems[0]?.label).toBe("apollo-11");
    const comp = doc.findComponent("apollo-11/cm");
    expect(comp).toBeDefined();
    expect(comp?.label).toBe("cm");
    expect(comp?.source).toBe("cm");
    // The definition preserves its description.
    expect(doc.definitions[0]?.description).toBe("Command module");
  });

  it("serializes multi-system reuse as standalone definitions + instances", () => {
    // A definition reused across two systems must serialize as one standalone
    // top-level `component` block with `instance` references, never inlined.
    const systemHcl = `component "engine" {
  description = "shared engine"
  leaf = true
}
system "airborne" {
  instance "plane" {
    source = "engine"
  }
}
system "hangar" {
  instance "plane" {
    source = "engine"
  }
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    expect(doc.systems).toHaveLength(2);
    const hcl = doc.systemHcl;

    // The shared definition is emitted once under its own label, not the
    // instance paths.
    expect(hcl).toContain('component "engine" {');
    expect(hcl).not.toContain('component "airborne/plane" {');
    expect(hcl).not.toContain('component "hangar/plane" {');
    // Systems reference their children via instance/source pointing at the
    // definition.
    expect(hcl).toContain('instance "plane" {\n    source = "engine"');
    expect(hcl).toContain('instance "plane" {\n    source = "engine"');

    // Round-trip compiles with no errors.
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("round-trips a loaded model with child-to-sibling and child-to-child connections", () => {
    // The HCL the editor produces after: satellite{radio, obc}, ground-station,
    // plus radio->ground-station and radio->obc connections.
    const systemHcl = `component "radio" {
  leaf = true
}
component "obc" {
  leaf = true
}
component "satellite" {
  instance "radio" {
    source = "radio"
  }
  instance "obc" {
    source = "obc"
  }
}
component "ground-station" {
  leaf = true
}
system "main" {
  instance "satellite" {
    source = "satellite"
  }
  instance "ground-station" {
    source = "ground-station"
  }

  connection "radio-ground-station" {
    from = "satellite/radio"
    to   = "ground-station"
  }
  connection "radio-obc" {
    from = "satellite/radio"
    to   = "satellite/obc"
  }
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    // Re-serializing and recompiling must not produce E002.
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("keeps a definition's label, not its instantiation path", () => {
    // A definition instantiated inside a system must keep its definition label
    // (satellite), not be renamed to the instance path (main/satellite).
    const systemHcl = `component "satellite" {
  description = "a satellite"
  leaf = true
}
system "main" {
  instance "satellite" {
    source = "satellite"
  }
}
`;
    const doc = new DocumentStore();
    doc.loadFromHcl(systemHcl);

    const hcl = doc.systemHcl;
    expect(hcl).toContain('component "satellite" {');
    expect(hcl).not.toContain('component "main/satellite" {');
    expect(hcl).toContain('instance "satellite" {\n    source = "satellite"');
    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("round-trips connections from a child to a sibling and to a sibling child", () => {
    // Build: mobile/antenna, mobile/baseband{rf, dsp}. Connect
    // rf->antenna and rf->dsp. Both must round-trip without E002.
    const doc = new DocumentStore();
    doc.addComponentDefinition("antenna", { leaf: true });
    doc.addComponentDefinition("rf", { leaf: true });
    doc.addComponentDefinition("dsp", { leaf: true });
    doc.addComponentDefinition("baseband", {
      description: "baseband processor",
    });
    doc.addSystem("mobile");
    doc.addInstance("mobile", "antenna", "antenna");
    doc.addInstance("mobile", "baseband", "baseband");
    doc.addInstance("baseband", "rf", "rf");
    doc.addInstance("baseband", "dsp", "dsp");

    doc.addConnection("mobile", {
      label: "rf-antenna",
      from: "baseband/rf",
      to: "antenna",
    });
    doc.addConnection("mobile", {
      label: "rf-dsp",
      from: "baseband/rf",
      to: "baseband/dsp",
    });

    expect(doc.compileResult.error_count()).toBe(0);
  });

  it("notifies the opt-in mutation observer of successful mutations", () => {
    const recorded: string[] = [];
    const unsubscribe = subscribeToMutations((action) => {
      recorded.push(action.op);
    });
    try {
      const doc = new DocumentStore();
      doc.setProject("obs", "0.1.0", []);
      doc.addComponentDefinition("drone", {
        leaf: false,
        description: "a drone",
        tags: ["power"],
        ports: [{ label: "rf", role: "peer" }],
      });
      doc.updateComponent("drone", { description: "updated" });
      doc.addSystem("main");
      doc.addInstance("main", "drone", "drone");
      doc.deleteComponent("main/drone");

      expect(recorded).toEqual([
        "new_project",
        "add_component_definition",
        "update_component",
        "add_system",
        "add_instance",
        "delete_component",
      ]);
    } finally {
      unsubscribe();
    }
  });

  it("does not notify observers for no-op mutations", () => {
    const recorded: string[] = [];
    const unsubscribe = subscribeToMutations((action) => {
      recorded.push(action.op);
    });
    try {
      const doc = new DocumentStore();
      doc.addSystem("main");
      // Duplicate system is a no-op.
      doc.addSystem("main");
      // updateComponent on a missing path is a no-op.
      doc.updateComponent("main/missing", { description: "x" });
      expect(recorded).toEqual(["add_system"]);
    } finally {
      unsubscribe();
    }
  });

  it("creates an instance that round-trips and reuses across systems", () => {
    const doc = new DocumentStore();
    doc.addSystem("drone");
    doc.addSystem("testing-harness");

    // Define a reusable composite engine as a top-level definition.
    doc.addComponentDefinition("engine", {
      leaf: false,
      description: "turboprop engine",
    });
    doc.addComponentDefinition("fuel-pump", { leaf: true });
    doc.addInstance("engine", "fuel-pump", "fuel-pump");

    // Reuse it in both systems via instance.
    const inst = doc.addInstance("testing-harness", "engine", "engine");
    expect(inst).toBeDefined();
    expect(inst?.source).toBe("engine");

    doc.addInstance("drone", "engine", "engine");

    const hcl = doc.systemHcl;
    expect(hcl).toContain('component "engine" {');
    expect(hcl).toContain('description = "turboprop engine"');
    // The definition body holds the nested instance.
    expect(hcl).toContain('instance "fuel-pump" {\n    source = "fuel-pump"');
    // Both systems reference the same definition by instance.
    expect(hcl).toContain('instance "engine" {\n    source = "engine"');

    // The sourced model still compiles with no errors.
    expect(doc.compileResult.error_count()).toBe(0);
  });
});
