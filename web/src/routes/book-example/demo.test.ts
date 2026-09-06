import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compile_system, parse_views } from "../../rhizz_wasm_wrapper";
import { DEMO_FILES } from "./demo";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("book-example demo project", () => {
  it("compiles with no errors", () => {
    const sources = DEMO_FILES.filter(
      (file) => !file.path.startsWith("diagrams/"),
    ).map((file) => ({ filename: file.path, content: file.content }));
    const output = compile_system(sources);
    expect(output.error_count()).toBe(0);
    expect(output.model()).toBeDefined();
  });

  it("ships one placed diagram with an annotation", () => {
    const diagram = DEMO_FILES.find(
      (file) => file.path === "diagrams/main.hcl",
    );
    expect(diagram).toBeDefined();
    const views = parse_views(diagram?.content ?? "");
    expect(views).toHaveLength(1);
    expect(views[0]?.nodes).toHaveLength(2);
    expect(views[0]?.annotations).toHaveLength(1);
  });
});
