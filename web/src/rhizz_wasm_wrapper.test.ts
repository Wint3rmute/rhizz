import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compile_system,
  parse_views,
  serialize_model,
  serialize_views,
} from "./rhizz_wasm_wrapper";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("rhizz_wasm_wrapper", () => {
  it("compiles and serializes model via WASM", () => {
    const sources = [
      {
        filename: "system.hcl",
        content: `project {
  name    = "test-proj"
  version = "1.0.0"
}

system "quad" {
  description = "Quadcopter"

  component "fc" {
    description = "Flight controller"
    leaf        = true
  }
}
`,
      },
    ];

    const result = compile_system(sources);
    expect(result.error_count()).toBe(0);
    const model = result.model();
    expect(model).toBeDefined();

    if (model) {
      const hcl = serialize_model(model);
      expect(hcl).toContain(
        'project {\n  name    = "test-proj"\n  version = "1.0.0"\n}',
      );
      expect(hcl).toContain('system "quad"');
      expect(hcl).toContain('component "fc"');
    }
  });

  it("parses and serializes views with node layout", () => {
    const viewsHcl = `view "main" {
  description = "Main diagram"
  system      = "quad"

  filter {
    max_level = 2
  }

  output {
    filename = "main.dot"
    rankdir  = "LR"
  }

  node "fc" {
    x          = 120
    y          = 240
    width      = 150
    height     = 100
    text_align = "top-left"
  }
}
`;

    const views = parse_views(viewsHcl);
    expect(views).toHaveLength(1);
    expect(views[0].label).toBe("main");
    expect(views[0].system).toBe("quad");
    expect(views[0].nodes).toHaveLength(1);
    expect(views[0].nodes?.[0].component).toBe("fc");
    expect(views[0].nodes?.[0].x).toBe(120);
    expect(views[0].nodes?.[0].y).toBe(240);

    const serialized = serialize_views(views);
    expect(serialized).toContain('view "main"');
    expect(serialized).toContain('node "fc"');
    expect(serialized).toContain("x          = 120");

    const views2 = parse_views(serialized);
    expect(views2).toEqual(views);
  });
});
