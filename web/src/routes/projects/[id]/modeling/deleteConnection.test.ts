import init from "rhizz";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compile_system } from "../../../../rhizz_wasm_wrapper";
import { buildDeleteConnectionRequest } from "./deleteConnection";

beforeAll(async () => {
  const wasmPath = nodePath.resolve(
    __dirname,
    "../../../../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await nodeFs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

function request(hcl: string, label: string) {
  const model = compile_system([
    { filename: "system.hcl", content: hcl },
  ]).model();
  return buildDeleteConnectionRequest(model, label);
}

const LINKED = `
component "a" {
  leaf = true
  port "out" {}
}
component "b" {
  leaf = true
  port "in" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "link" {
    from = "a/out"
    to   = "b/in"
  }
}
`;

describe("deleteConnectionRequest", () => {
  it("is undefined without a model or an unknown connection", () => {
    expect(buildDeleteConnectionRequest(undefined, "link")).toBeUndefined();
    expect(request(LINKED, "nope")).toBeUndefined();
  });

  it("names both endpoints and every unused endpoint port", () => {
    const found = request(LINKED, "link");
    expect(found?.from).toEqual({
      key: "demo/a",
      component: "a",
      port: "out",
      definition: "a",
    });
    expect(found?.to).toEqual({
      key: "demo/b",
      component: "b",
      port: "in",
      definition: "b",
    });
    expect(found?.removablePorts).toEqual([
      { definition: "a", port: "out", component: "a" },
      { definition: "b", port: "in", component: "b" },
    ]);
    expect(found?.keptPorts).toEqual([]);
  });

  it("keeps a port another connection still uses, and says which", () => {
    const found = request(
      `
component "a" {
  leaf = true
  port "out" {}
}
component "b" {
  leaf = true
  port "in" {}
  port "spare" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "one" {
    from = "a/out"
    to   = "b/in"
  }
  connection "two" {
    from = "a/out"
    to   = "b/spare"
  }
}
`,
      "one",
    );
    expect(found?.keptPorts).toEqual([
      {
        definition: "a",
        port: "out",
        component: "a",
        usedBy: ["two"],
      },
    ]);
    expect(found?.removablePorts).toEqual([
      { definition: "b", port: "in", component: "b" },
    ]);
  });

  it("does not count copies of the same declaration as other users", () => {
    const found = request(
      `
component "x" {
  leaf = true
  port "out" {}
}
component "y" {
  leaf = true
  port "in" {}
}
component "pair" {
  instance "x" { source = "x" }
  instance "y" { source = "y" }
  connection "link" {
    from = "x/out"
    to   = "y/in"
  }
}
system "demo" {
  instance "p1" { source = "pair" }
  instance "p2" { source = "pair" }
}
`,
      "link",
    );
    expect(found?.keptPorts).toEqual([]);
    expect(found?.removablePorts).toEqual([
      { definition: "x", port: "out", component: "x" },
      { definition: "y", port: "in", component: "y" },
    ]);
  });

  it("attributes a nested endpoint port to its definition", () => {
    const found = request(
      `
component "child" {
  leaf = true
  port "inner" {}
}
component "parent" {
  port "outer" {}
  instance "c" { source = "child" }
}
system "demo" {
  instance "p" { source = "parent" }
  connection "cross" {
    from = "p/c/inner"
    to   = "p/outer"
  }
}
`,
      "cross",
    );
    expect(found?.from).toMatchObject({
      key: "demo/p/c",
      component: "c",
      port: "inner",
      definition: "child",
    });
    expect(found?.to).toMatchObject({
      key: "demo/p",
      component: "p",
      port: "outer",
      definition: "parent",
    });
  });

  it("reports a bare endpoint with no port to clean up", () => {
    const found = request(
      `
component "a" {
  leaf = true
}
component "b" {
  leaf = true
  port "in" {}
}
system "demo" {
  instance "a" { source = "a" }
  instance "b" { source = "b" }
  connection "link" {
    from = "a"
    to   = "b/in"
  }
}
`,
      "link",
    );
    expect(found?.from.port).toBeUndefined();
    expect(found?.removablePorts).toEqual([
      { definition: "b", port: "in", component: "b" },
    ]);
  });
});
