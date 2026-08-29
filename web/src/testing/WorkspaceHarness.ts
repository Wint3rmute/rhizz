import init, { type ComponentJS, type SystemJS } from "rhizz";
import { DocumentStore, type ComponentData } from "../DocumentStore.svelte";
import {
  compile_system,
  type ExampleProject,
  get_example_projects,
  serialize_model,
} from "../rhizz_wasm_wrapper";
import { componentKey } from "../routes/projects/[id]/diagrams/persistence";
import { readProjectSources, type Source } from "../vfs/compile";
import { openProjectFs, type ProjectFs } from "../vfs/fs";
import { InMemoryProjectStore } from "../vfs/inMemoryStore";

export type ExampleId = "drone" | "software-house" | "apollo-11";

let wasmReady: Promise<unknown> | null = null;

function ensureWasm(): Promise<unknown> {
  wasmReady ??= init();
  return wasmReady;
}

export interface WorkspaceSnapshot {
  canonicalHcl: string;
  componentKeys: string[];
}

async function populateFiles(
  fs: ProjectFs,
  files: ExampleProject["files"],
): Promise<void> {
  for (const file of files) {
    const targetPath = file.path.startsWith("diagrams/")
      ? `.rhizz/${file.path}`
      : file.path;
    const lastSlash = targetPath.lastIndexOf("/");
    if (lastSlash !== -1) {
      await fs.mkdir(targetPath.slice(0, lastSlash), { recursive: true });
    }
    await fs.writeFile(targetPath, file.content);
  }
}

export class WorkspaceHarness {
  readonly fs: ProjectFs;
  #sources: Source[] = [];
  #components: ComponentJS[] = [];
  #systems: SystemJS[] = [];
  #canonicalHcl = "";
  #selectedIndex: number | null = null;

  private constructor(fs: ProjectFs) {
    this.fs = fs;
  }

  static async empty(): Promise<WorkspaceHarness> {
    await ensureWasm();
    const store = new InMemoryProjectStore(() => "2026-01-01T00:00:00.000Z");
    const project = await store.createProject("simulation-empty");
    const fs = openProjectFs(store, project.id);
    await fs.writeFile("main.hcl", "# Empty simulation project\n");
    const harness = new WorkspaceHarness(fs);
    await harness.recompile();
    return harness;
  }

  static async fromExample(id: ExampleId): Promise<WorkspaceHarness> {
    await ensureWasm();
    const example = get_example_projects().find((candidate) => candidate.id === id);
    if (!example) throw new Error(`Example project ${id} not found`);

    const store = new InMemoryProjectStore(() => "2026-01-01T00:00:00.000Z");
    const project = await store.createProject(`simulation-${id}`);
    const fs = openProjectFs(store, project.id);
    await populateFiles(fs, example.files);
    const harness = new WorkspaceHarness(fs);
    await harness.recompile();
    return harness;
  }

  get sources(): readonly Source[] {
    return this.#sources;
  }

  get componentKeys(): string[] {
    return this.#components.map((_, index) =>
      componentKey(index, this.#components, this.#systems)
    );
  }

  get selectedComponentKey(): string | null {
    if (this.#selectedIndex === null) return null;
    return componentKey(this.#selectedIndex, this.#components, this.#systems);
  }

  get selectedIndex(): number | null {
    return this.#selectedIndex;
  }

  selectComponent(key: string): void {
    const index = this.componentKeys.indexOf(key);
    if (index === -1) throw new Error(`Component ${key} not found`);
    this.#selectedIndex = index;
  }

  snapshot(): WorkspaceSnapshot {
    return {
      canonicalHcl: this.#canonicalHcl,
      componentKeys: this.componentKeys,
    };
  }

  blockingErrorCodes(): string[] {
    const output = compile_system([...this.#sources]);
    return output.diagnostics()
      .filter((diagnostic) => diagnostic.code.startsWith("E"))
      .map((diagnostic) => diagnostic.code);
  }

  async recompile(): Promise<void> {
    this.#sources = await readProjectSources(this.fs);
    if (this.#sources.length === 0) {
      this.#components = [];
      this.#systems = [];
      this.#canonicalHcl = "";
      return;
    }

    const output = compile_system([...this.#sources]);
    const model = output.model();
    if (!model) {
      const errors = output.diagnostics()
        .filter((diagnostic) => diagnostic.code.startsWith("E"))
        .map((diagnostic) => diagnostic.code)
        .join(", ");
      throw new Error(`Workspace failed to compile: ${errors}`);
    }
    this.#components = model.components();
    this.#systems = model.systems();
    this.#canonicalHcl = serialize_model(model);
  }

  async roundTrip(): Promise<WorkspaceSnapshot> {
    await this.recompile();
    return this.snapshot();
  }

  async setSelectedComponentVisuals(
    patch: Pick<Partial<ComponentData>, "color" | "border" | "font" | "icon">,
  ): Promise<void> {
    const selectedKey = this.selectedComponentKey;
    if (!selectedKey) throw new Error("No component selected");
    const primary = await this.primaryHclFile();
    const content = await this.fs.readFile(primary);
    const doc = new DocumentStore();
    doc.loadFromHcl(content);
    if (!doc.updateComponent(selectedKey, patch)) {
      throw new Error(`Component ${selectedKey} not found in ${primary}`);
    }
    await this.fs.writeFile(primary, doc.systemHcl);
    await this.recompile();
  }

  private async primaryHclFile(): Promise<string> {
    const entries = await this.fs.readdir(".", { recursive: true });
    const files = entries.filter((entry) =>
      entry.isFile() && entry.name.endsWith(".hcl") &&
      !entry.path.startsWith(".rhizz/") &&
      !entry.path.startsWith("diagrams/")
    );
    const preferred = ["system.hcl", "systems.hcl", "main.hcl", "project.hcl"]
      .map((name) => files.find((entry) => entry.name === name))
      .find((entry) => entry !== undefined);
    return preferred?.path ?? files[0]?.path ?? "main.hcl";
  }
}
