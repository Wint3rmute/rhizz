import init from "rhizz";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DocumentStore } from "./DocumentStore.svelte";
import { compile_system, serialize_model } from "./rhizz_wasm_wrapper";

beforeAll(async () => {
  const wasmPath = path.resolve(
    __dirname,
    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",
  );
  const buffer = await fs.readFile(wasmPath);
  await init({ module_or_path: buffer });
});

describe("DocumentStore.canonicalHcl (Audit finding 1)", () => {
  it("derives Rust-canonical HCL via WASM instead of the TS emitter", () => {
    const doc = new DocumentStore();
    doc.setProject("demo", "1.0.0", []);
    doc.addComponentDefinition("cpu", { leaf: true });
    doc.addSystem("main");
    doc.addInstance("main", "cpu", "cpu");

    const draft = doc.systemHcl;
    const canonical = doc.canonicalHcl;

    expect(canonical).not.toBeNull();
    // TS draft emits a three-line instance block; Rust canonical is one line.
    expect(draft).toContain('instance "cpu" {\n    source = "cpu"');
    expect(canonical).toContain('instance "cpu" { source = "cpu" }');
    expect(canonical).not.toEqual(draft);
  });

  it("round-trips stably through the Rust serializer", () => {
    const doc = new DocumentStore();
    doc.addComponentDefinition("b-def", { leaf: true });
    doc.addComponentDefinition("a-def", { leaf: true });
    doc.addSystem("main");
    doc.addInstance("main", "b-def", "b-def");
    doc.addInstance("main", "a-def", "a-def");

    const canonical = doc.canonicalHcl;
    expect(canonical).not.toBeNull();

    const out = compile_system([{
      filename: "system.hcl",
      content: canonical as string,
    }]);
    const model = out.model();
    expect(model).toBeDefined();
    expect(out.error_count()).toBe(0);
    expect(serialize_model(model!)).toEqual(canonical);
  });
});
