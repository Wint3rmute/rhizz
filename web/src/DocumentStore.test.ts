import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentStore } from "./DocumentStore.svelte";
import { EMPTY_PROJECT_HCL } from "./emptyProject";
import { compile_system } from "./rhizz_wasm_wrapper";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("DocumentStore", () => {
  it("initializes with a default project and an empty model", () => {
    const doc = new DocumentStore();
    expect(doc.project.name).toBe("untitled");
    expect(doc.systems).toEqual([]);
    expect(doc.definitions).toEqual([]);
    expect(doc.protocols).toEqual([]);
  });

  it("parses the empty-project seed into a single main system", () => {
    const doc = new DocumentStore();
    doc.loadFromHcl(EMPTY_PROJECT_HCL);
    expect(doc.systems.map((s) => s.label)).toEqual(["main"]);
  });

  it("manages views and layout coordinates in viewsHcl", () => {
    const doc = new DocumentStore();
    doc.loadFromHcl('system "demo" {\n}\n');
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

    expect(doc.viewsHcl).toContain('view "wiring"');
  });

  it("preserves lowercase protocol roles when loading, without E009", () => {
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

    const sensor = doc.findComponent("sensor");
    expect(sensor?.ports.map((p) => p.role)).toEqual(["provider"]);
    const mcu = doc.findComponent("mcu");
    expect(mcu?.ports.map((p) => p.role)).toEqual(["consumer"]);

    expect(
      compile_system([{ filename: "system.hcl", content: systemHcl }])
        .error_count(),
    ).toBe(0);
  });

  it("reads component visual attributes (color, border, font)", () => {
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

    // A bare definition exposes no visual attributes.
    const plain = doc.findComponent("plain");
    expect(plain?.color).toBeFalsy();
    expect(plain?.border).toBeFalsy();
    expect(plain?.font).toBeFalsy();
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

  it("loads a model with child-to-sibling connections without E002", () => {
    // satellite{radio, obc}, ground-station, plus radio->ground-station and
    // radio->obc connections.
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

    expect(doc.findComponent("main/satellite/radio")).toBeDefined();
    expect(
      compile_system([{ filename: "system.hcl", content: systemHcl }])
        .error_count(),
    ).toBe(0);
  });
});
