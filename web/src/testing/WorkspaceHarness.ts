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

export interface ComponentVisualSnapshot {
  color: string;
  border: string;
  font: string;
  icon: string;
}

export type WorkspaceAction =
  | { type: "select-component"; component: string }
  | {
    type: "set-node-visuals";
    component: string;
    color?: string | undefined;
    border?: "solid" | "dashed" | "dotted" | undefined;
    font?: string | undefined;
  }
  | { type: "move-node"; component: string; x: number; y: number }
  | { type: "add-diagram-view"; name: string };

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
  #selectedKey: string | null = null;
  #activeDiagram = "main";
  #diagrams = new Set(["main"]);
  #layout = new Map<string, { x: number; y: number }>();
  #fixture: ExampleId | "empty";

  private constructor(fs: ProjectFs, fixture: ExampleId | "empty") {
    this.fs = fs;
    this.#fixture = fixture;
  }

  static async empty(): Promise<WorkspaceHarness> {
    await ensureWasm();
    const store = new InMemoryProjectStore(() => "2026-01-01T00:00:00.000Z");
    const project = await store.createProject("simulation-empty");
    const fs = openProjectFs(store, project.id);
    await fs.writeFile("main.hcl", "# Empty simulation project\n");
    const harness = new WorkspaceHarness(fs, "empty");
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
    const harness = new WorkspaceHarness(fs, id);
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
    return this.#selectedKey;
  }

  get activeDiagram(): string {
    return this.#activeDiagram;
  }

  layoutPosition(key: string): { x: number; y: number } | undefined {
    return this.#layout.get(key);
  }

  get selectedIndex(): number | null {
    if (this.#selectedKey === null) return null;
    const index = this.componentKeys.indexOf(this.#selectedKey);
    return index === -1 ? null : index;
  }

  selectComponent(key: string): void {
    if (!this.componentKeys.includes(key)) {
      throw new Error(`Component ${key} not found`);
    }
    this.#selectedKey = key;
  }

  async dispatch(action: WorkspaceAction): Promise<void> {
    switch (action.type) {
      case "select-component":
        this.selectComponent(action.component);
        return;
      case "set-node-visuals": {
        this.selectComponent(action.component);
        const selectedBefore = this.selectedComponentKey;
        await this.setSelectedComponentVisuals({
          color: action.color,
          border: action.border,
          font: action.font,
        });
        if (this.selectedComponentKey !== selectedBefore) {
          throw new Error(
            `selected-component-stability: before=${String(selectedBefore)} after=${String(this.selectedComponentKey)}`,
          );
        }
        return;
      }
      case "move-node":
        if (!this.componentKeys.includes(action.component)) {
          throw new Error(`Component ${action.component} not found`);
        }
        this.#layout.set(action.component, { x: action.x, y: action.y });
        return;
      case "add-diagram-view":
        this.#diagrams.add(action.name);
        this.#activeDiagram = action.name;
        return;
    }
  }

  assertInvariants(): void {
    const blocking = this.blockingErrorCodes();
    if (blocking.length > 0) {
      throw new Error(`compilability: ${blocking.join(", ")}`);
    }
    const roundTrip = this.roundTripSnapshot();
    const current = this.snapshot();
    if (JSON.stringify(roundTrip) !== JSON.stringify(current)) {
      throw new Error("round-trip-fidelity: canonical model changed");
    }
    if (!this.#diagrams.has(this.#activeDiagram)) {
      throw new Error(`referential-integrity: active diagram ${this.#activeDiagram} does not resolve`);
    }
    for (const key of this.#layout.keys()) {
      if (!this.componentKeys.includes(key)) {
        throw new Error(`referential-integrity: layout component ${key} does not resolve`);
      }
    }
    if (
      this.#selectedKey !== null &&
      !this.componentKeys.includes(this.#selectedKey)
    ) {
      throw new Error(
        `referential-integrity: selected component ${this.#selectedKey} does not resolve`,
      );
    }
  }

  async editableComponentKeys(): Promise<string[]> {
    // The current diagram mutation path rewrites one primary HCL file through
    // DocumentStore. Multi-file projects and Apollo's sourced component
    // instances require source-aware editing; flattening a resolved sourced
    // instance back into the usage site would violate E011. Those fixtures still
    // participate in compile/round-trip invariants, but generated visual edits
    // are limited to fixtures the current UI writer can safely round-trip.
    if (this.#sources.length !== 1 || this.#fixture === "apollo-11") return [];
    const primary = await this.primaryHclFile();
    const content = await this.fs.readFile(primary);
    const doc = new DocumentStore();
    if (content.trim()) doc.loadFromHcl(content);
    return this.componentKeys.filter((key) => doc.findComponent(key) !== null);
  }

  componentVisuals(): Record<string, ComponentVisualSnapshot> {
    const visuals: Record<string, ComponentVisualSnapshot> = {};
    this.#components.forEach((component, index) => {
      visuals[componentKey(index, this.#components, this.#systems)] = {
        color: component.color,
        border: component.border,
        font: component.font,
        icon: component.icon,
      };
    });
    return visuals;
  }

  snapshot(): WorkspaceSnapshot {
    return {
      canonicalHcl: this.#canonicalHcl,
      componentKeys: this.componentKeys.toSorted(),
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

  roundTripSnapshot(): WorkspaceSnapshot {
    if (this.#canonicalHcl === "") return this.snapshot();
    const output = compile_system([{
      filename: "roundtrip.hcl",
      content: this.#canonicalHcl,
    }]);
    const model = output.model();
    if (!model) {
      const errors = output.diagnostics()
        .filter((diagnostic) => diagnostic.code.startsWith("E"))
        .map((diagnostic) => diagnostic.code)
        .join(", ");
      throw new Error(`Canonical model failed to round-trip: ${errors}`);
    }
    const components = model.components();
    const systems = model.systems();
    return {
      canonicalHcl: serialize_model(model),
      componentKeys: components.map((_, index) =>
        componentKey(index, components, systems)
      ).toSorted(),
    };
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
