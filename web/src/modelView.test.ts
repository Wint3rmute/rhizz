import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  componentDataByKey,
  connectionByRef,
  connectionDataList,
  definitionOptions,
  protocolDataList,
  protocolUnresolvedReason,
  protocolUsageCount,
} from "./modelView";
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

  it("carries the sourced definition on instances but not on definitions", () => {
    const view = viewOf(`component "sensor" {
  leaf = true
}
system "demo" {
  instance "s1" {
    source = "sensor"
  }
}
`);
    // The instance remembers the definition it was cloned from, so the UI can
    // link back to it. The label differs from the source, which is exactly the
    // case that makes the distinction worth surfacing.
    expect(view.get("demo/s1")?.source).toBe("sensor");
    // A definition is not an instance of anything, so it has no source.
    expect(view.get("sensor")?.source).toBeUndefined();
  });

  it("preserves lowercase port roles, without E009", () => {
    const systemHcl = `protocol "i2c" {
  full_name = "I2C bus"
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
      compile_system([
        { filename: "system.hcl", content: systemHcl },
      ]).error_count(),
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
  full_name = "Command module"
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
        filename: "views/main.hcl",
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
    expect(view.get("cm")?.full_name).toBe("Command module");
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
    const model = modelOf([
      {
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
      },
    ]);
    expect(definitionOptions(model)).toEqual([
      { sourceLabel: "anchor", label: "anchor", icon: undefined },
      { sourceLabel: "zeppelin", label: "zeppelin", icon: "cloud" },
    ]);
  });

  it("omits placed instances, which are not reusable definitions", () => {
    const model = modelOf([
      {
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
      },
    ]);
    expect(definitionOptions(model).map((d) => d.sourceLabel)).toEqual([
      "sensor",
    ]);
  });
});

/**
 * Two banks whose `pay` ports share the `payment` protocol. `fund-transfer`
 * (payment) is realized by `http-request` (https). `httpsLeaf` decides whether
 * that chain bottoms out, which is the difference between complete and
 * incomplete.
 */
function bankingChain(httpsLeaf: boolean): string {
  return `protocol "payment" {}
protocol "https" {
  leaf         = ${httpsLeaf ? "true" : "false"}
  encapsulates = ["payment"]
}
component "bank" {
  leaf = true
  port "pay" {
    protocol = "payment"
  }
  port "web" {
    protocol = "https"
  }
}
system "banking" {
  instance "bank-a" {
    source = "bank"
  }
  instance "bank-b" {
    source = "bank"
  }
  connection "fund-transfer" {
    from        = "bank-a/pay"
    to          = "bank-b/pay"
    realized_by = ["http-request"]
  }
  connection "http-request" {
    from = "bank-a/web"
    to   = "bank-b/web"
  }
}
`;
}

describe("connectionDataList", () => {
  const banking = { scopePath: "banking", label: "http-request" };
  const transfer = { scopePath: "banking", label: "fund-transfer" };

  it("is empty for an undefined model", () => {
    expect(connectionDataList(undefined)).toEqual([]);
  });

  it("addresses connections by scope and label, with their endpoint ports", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    const found = connectionByRef(list, transfer);
    expect(found).toBeDefined();
    expect(found?.ref).toEqual(transfer);
    expect(found?.from_port).toBe("pay");
    expect(found?.to_port).toBe("pay");
    expect(found?.protocol).toBe("payment");
  });

  it("lists the realization targets as refs the op can send back", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    expect(connectionByRef(list, transfer)?.realized_by).toEqual([banking]);
    expect(connectionByRef(list, banking)?.realized_by).toEqual([]);
  });

  it("reports a complete chain as complete, with no blocker", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    const found = connectionByRef(list, transfer);
    expect(found?.complete).toBe(true);
    expect(found?.blocking).toBeUndefined();
  });

  it("names the root-cause connection of an incomplete chain", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(false) }]),
    );
    const found = connectionByRef(list, transfer);
    expect(found?.complete).toBe(false);
    expect(found?.blocking).toEqual(banking);
    // The root cause itself has no blocker: its own protocol is the gap.
    expect(connectionByRef(list, banking)?.blocking).toBeUndefined();
  });
});

describe("connectionByRef and protocolUsageCount", () => {
  it("returns undefined for an address that names no connection", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    expect(
      connectionByRef(list, { scopePath: "banking", label: "missing" }),
    ).toBeUndefined();
    // Same label, different scope: not the same connection.
    expect(
      connectionByRef(list, { scopePath: "bank-a", label: "fund-transfer" }),
    ).toBeUndefined();
  });

  it("counts the connections typed by a protocol", () => {
    const list = connectionDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    expect(protocolUsageCount(list, "payment")).toBe(1);
    expect(protocolUsageCount(list, "https")).toBe(1);
    expect(protocolUsageCount(list, "ftp")).toBe(0);
  });
});

describe("protocol read model", () => {
  it("exposes leaf and declared encapsulates on each protocol", () => {
    const model = modelOf([
      { filename: "system.hcl", content: bankingChain(true) },
    ]);
    const https = model?.protocols().find((p) => p.label === "https");
    expect(https?.leaf).toBe(true);
    expect(https?.encapsulates).toEqual(["payment"]);
    const payment = model?.protocols().find((p) => p.label === "payment");
    expect(payment?.leaf).toBe(false);
    expect(payment?.encapsulates).toEqual([]);
  });
});

describe("protocolUnresolvedReason", () => {
  it("is undefined when both ports share a defined protocol", () => {
    expect(
      protocolUnresolvedReason({ protocol: "https" }, { protocol: "https" }, [
        "https",
      ]),
    ).toBeUndefined();
  });

  it("names a bare endpoint with no port", () => {
    expect(
      protocolUnresolvedReason(undefined, { protocol: "https" }, ["https"]),
    ).toMatch(/bare component/);
  });

  it("names an untyped port", () => {
    expect(
      protocolUnresolvedReason({ protocol: "" }, { protocol: "https" }, [
        "https",
      ]),
    ).toMatch(/no protocol/);
  });

  it("names a mismatch and both protocols", () => {
    const reason = protocolUnresolvedReason(
      { protocol: "https" },
      { protocol: "i2c" },
      ["https", "i2c"],
    );
    expect(reason).toMatch(/different protocols \(https and i2c\)/);
  });

  it("names a shared protocol that is not defined", () => {
    expect(
      protocolUnresolvedReason({ protocol: "ghost" }, { protocol: "ghost" }, [
        "https",
      ]),
    ).toMatch(/"ghost" is not defined/);
  });
});

describe("protocolDataList", () => {
  it("projects every protocol with its fields, sorted as declared", () => {
    const list = protocolDataList(
      modelOf([{ filename: "system.hcl", content: bankingChain(true) }]),
    );
    const https = list.find((p) => p.label === "https");
    expect(https).toEqual({
      label: "https",
      full_name: "",
      roles: [],
      leaf: true,
      encapsulates: ["payment"],
    });
    expect(list.map((p) => p.label).sort()).toEqual(["https", "payment"]);
  });

  it("is empty for an undefined model", () => {
    expect(protocolDataList(undefined)).toEqual([]);
  });
});
