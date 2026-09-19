import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { componentDataByKey, definitionOptions } from "./modelView";
import { compile_system } from "./rhizz_wasm_wrapper";
import type { Source } from "./vfs/compile";

beforeAll(async () => {
  const wasmPath = nodePath.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await nodeFs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

/** Compiles one HCL document and projects it into the flat read-model. */
function viewOf(hcl: string, filename = "system.hcl") {
  return componentDataByKey(
    compile_system([{ filename, content: hcl }]).model(),
  );
}

function modelOf(sources: Source[]) {
  return compile_system(sources).model();
}

describe("componentDataByKey", () => {
  it("is empty for an undefined model", () => {
    expect(componentDataByKey(undefined).size).toBe(0);
  });

  it("keys definitions by their bare label and instances by their full path", () => {
    const view = viewOf(`component "sensor" {
  leaf = true
}
system "demo" {
  instance "s1" {
    source = "sensor"
  }
}
`);
    expect([...view.keys()].sort()).toEqual(["demo/s1", "sensor"]);
    expect(view.get("demo/s1")?.label).toBe("s1");
  });

  it("keys nested instances by their whole ancestor path", () => {
    const view = viewOf(`component "radio" {
  leaf = true
}
component "satellite" {
  instance "radio" {
    source = "radio"
  }
}
system "main" {
  instance "satellite" {
    source = "satellite"
  }
}
`);
    expect(view.has("main/satellite/radio")).toBe(true);
  });

  it("reads component visual attributes (color, border, font)", () => {
    const view = viewOf(`component "danger" {
  color  = "#ff0000"
  border = "dashed"
  font   = "bold"
}

component "plain" {
  leaf = true
}
`);
    const danger = view.get("danger");
    expect(danger?.color).toBe("#ff0000");
    expect(danger?.border).toBe("dashed");
    expect(danger?.font).toBe("bold");

    // A component with no visual attributes normalizes to the explicit
    // defaults, so readers never branch on absence.
    const plain = view.get("plain");
    expect(plain?.color).toBe("default");
    expect(plain?.border).toBe("solid");
    expect(plain?.font).toBe("unstyled");
  });

  it("normalizes an unknown border style to solid", () => {
    const view = viewOf(`component "weird" {
  border = "wavy"
}
`);
    expect(view.get("weird")?.border).toBe("solid");
  });

  it("preserves lowercase port roles, without E009", () => {
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
    const view = viewOf(systemHcl);
    expect(view.get("sensor")?.ports.map((p) => p.role)).toEqual(["provider"]);
    expect(view.get("mcu")?.ports.map((p) => p.role)).toEqual(["consumer"]);
    expect(view.get("sensor")?.ports[0]?.protocol).toBe("i2c");
    expect(
      compile_system([{ filename: "system.hcl", content: systemHcl }])
        .error_count(),
    ).toBe(0);
  });

  it("defaults an unroled port to peer and marks it required", () => {
    const view = viewOf(`component "plain" {
  leaf = true
  port "p" {
  }
}
`);
    const port = view.get("plain")?.ports[0];
    expect(port?.role).toBe("peer");
    expect(port?.required).toBe(true);
  });

  it("finds components across multi-file sources by persistence key", () => {
    const model = modelOf([
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
    ]);
    const view = componentDataByKey(model);
    expect(view.get("apollo-11/cm")?.label).toBe("cm");
    expect(view.get("cm")?.description).toBe("Command module");
  });

  it("carries tags and the leaf flag", () => {
    const view = viewOf(`component "tagged" {
  leaf = true
  tags = ["power", "flight"]
}
component "composite" {
}
`);
    expect(view.get("tagged")?.tags).toEqual(["power", "flight"]);
    expect(view.get("tagged")?.leaf).toBe(true);
    expect(view.get("composite")?.leaf).toBe(false);
  });
});

describe("definitionOptions", () => {
  it("is empty for an undefined model", () => {
    expect(definitionOptions(undefined)).toEqual([]);
  });

  it("lists top-level definitions, sorted by label, even with zero instances", () => {
    const model = modelOf([{
      filename: "system.hcl",
      content: `component "zeppelin" {
  leaf = true
  icon = "cloud"
}
component "anchor" {
  leaf = true
}
system "main" {
}
`,
    }]);
    expect(definitionOptions(model)).toEqual([
      { sourceLabel: "anchor", label: "anchor", icon: undefined },
      { sourceLabel: "zeppelin", label: "zeppelin", icon: "cloud" },
    ]);
  });

  it("omits placed instances, which are not reusable definitions", () => {
    const model = modelOf([{
      filename: "system.hcl",
      content: `component "sensor" {
  leaf = true
}
system "main" {
  instance "s1" {
    source = "sensor"
  }
}
`,
    }]);
    expect(definitionOptions(model).map((d) => d.sourceLabel)).toEqual([
      "sensor",
    ]);
  });
});
