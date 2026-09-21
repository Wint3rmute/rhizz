import init, { type ComponentJS } from "rhizz";
import type { ComponentData } from "../modelView";
import {
  compile_system,
  type ExampleProject,
  get_example_projects,
  serialize_model,
} from "../rhizz_wasm_wrapper";
import { readProjectSources, type Source } from "../vfs/compile";
import {
  applyModelMutation,
  type ModelMutationOp,
} from "../history/applyMutation";
import {
  snapshotTransaction,
  TransactionManager,
} from "../history/TransactionManager";
import { openProjectFs, type ProjectFs } from "../vfs/fs";
import { InMemoryProjectStore } from "../vfs/vfsStore";

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
  color: string | undefined;
  border: string | undefined;
  font: string | undefined;
  icon: string | undefined;
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
  | { type: "add-diagram-view"; name: string }
  | {
    type: "create-component";
    label: string;
    parentKey?: string | undefined;
    sourceLabel?: string | undefined;
  }
  | { type: "delete-component"; component: string }
  | {
    type: "add-connection";
    scopePath: string;
    label: string;
    from: string;
    to: string;
  }
  | { type: "delete-connection"; label: string }
  | { type: "undo" }
  | { type: "redo" };

async function populateFiles(
  fs: ProjectFs,
  files: ExampleProject["files"],
): Promise<void> {
  for (const file of files) {
    const targetPath = file.path;
    const lastSlash = targetPath.lastIndexOf("/");
    if (lastSlash !== -1) {
      await fs.mkdir(targetPath.slice(0, lastSlash), { recursive: true });
    }
    await fs.writeFile(targetPath, file.content);
  }
}

export class WorkspaceHarness {
  readonly fs: ProjectFs;
  readonly transactions = new TransactionManager(100);
  #sources: Source[] = [];
  #components: ComponentJS[] = [];
  #componentKeys: string[] = [];
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
    const example = get_example_projects().find((candidate) =>
      candidate.id === id
    );
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
    return this.#componentKeys;
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
        await this.executeModelTransaction(
          `visual ${action.component}`,
          {
            kind: "update_component",
            path: action.component,
            patch: {
              ...(action.color === undefined ? {} : { color: action.color }),
              ...(action.border === undefined ? {} : { border: action.border }),
              ...(action.font === undefined ? {} : { font: action.font }),
            },
          },
          action.component,
        );
        return;
      }
      case "move-node":
        if (!this.componentKeys.includes(action.component)) {
          throw new Error(`Component ${action.component} not found`);
        }
        await this.executeLayoutTransaction(
          `move ${action.component}`,
          () => {
            this.#layout.set(action.component, {
              x: action.x,
              y: action.y,
            });
          },
        );
        return;
      case "add-diagram-view":
        await this.executeLayoutTransaction(
          `view ${action.name}`,
          () => {
            this.#diagrams.add(action.name);
            this.#activeDiagram = action.name;
          },
        );
        return;
      case "create-component":
        await this.executeModelTransaction(
          `create ${action.label}`,
          {
            kind: "create_component",
            label: action.label,
            ...(action.parentKey === undefined
              ? {}
              : { parentKey: action.parentKey }),
            ...(action.sourceLabel === undefined
              ? {}
              : { sourceLabel: action.sourceLabel }),
            leaf: true,
          },
          undefined,
          true,
        );
        return;
      case "delete-component":
        await this.executeModelTransaction(
          `delete ${action.component}`,
          { kind: "delete_component", path: action.component },
          undefined,
          true,
        );
        return;
      case "add-connection":
        await this.executeModelTransaction(
          `connect ${action.label}`,
          {
            kind: "add_connection",
            scopePath: action.scopePath,
            label: action.label,
            from: action.from,
            to: action.to,
          },
          undefined,
          true,
        );
        return;
      case "delete-connection":
        await this.executeModelTransaction(
          `disconnect ${action.label}`,
          { kind: "delete_connection_by_label", label: action.label },
          undefined,
          true,
        );
        return;
      case "undo":
        await this.undo();
        return;
      case "redo":
        await this.redo();
        return;
    }
  }

  get canUndo(): boolean {
    return this.transactions.canUndo;
  }

  get canRedo(): boolean {
    return this.transactions.canRedo;
  }

  async undo(): Promise<boolean> {
    const undone = await this.transactions.undo();
    if (undone) await this.recompile();
    return undone;
  }

  async redo(): Promise<boolean> {
    const redone = await this.transactions.redo();
    if (redone) await this.recompile();
    return redone;
  }

  private async snapshotHarness(): Promise<{
    primaryPath: string;
    primaryContent: string;
    layout: [string, { x: number; y: number }][];
    diagrams: string[];
    active: string;
    selected: string | null;
  }> {
    const primaryPath = await this.primaryHclFile();
    let primaryContent: string;
    try {
      primaryContent = await this.fs.readFile(primaryPath);
    } catch {
      primaryContent = "";
    }
    return {
      primaryPath,
      primaryContent,
      layout: [...this.#layout.entries()].map(([key, pos]) => [
        key,
        { ...pos },
      ]),
      diagrams: [...this.#diagrams],
      active: this.#activeDiagram,
      selected: this.#selectedKey,
    };
  }

  private async restoreHarness(snapshot: {
    primaryPath: string;
    primaryContent: string;
    layout: [string, { x: number; y: number }][];
    diagrams: string[];
    active: string;
    selected: string | null;
  }): Promise<void> {
    await this.fs.writeFile(
      snapshot.primaryPath,
      snapshot.primaryContent,
    );
    this.#layout = new Map(snapshot.layout);
    this.#diagrams = new Set(snapshot.diagrams);
    this.#activeDiagram = snapshot.active;
    this.#selectedKey = snapshot.selected;
    await this.recompile();
  }

  /** Model mutation + recompile as one undoable transaction. */
  private async executeModelTransaction(
    label: string,
    op: ModelMutationOp,
    selectAfter?: string,
    lenient = false,
  ): Promise<boolean> {
    const tx = snapshotTransaction({
      label,
      snapshot: () => this.snapshotHarness(),
      apply: async () => {
        const before = await this.snapshotHarness();
        const result = await applyModelMutation(
          this.fs,
          before.primaryPath,
          before.primaryContent,
          op,
        );
        if (!result.applied) return false;
        if (selectAfter !== undefined) {
          try {
            this.selectComponent(selectAfter);
          } catch {
            // Selection follows the edit when possible; a renamed or
            // deleted key simply leaves the previous selection behind.
          }
        }
        // Place newly created components on the canvas so Ctrl+Z undoes
        // both the HCL entity and its visual placement.
        if (op.kind === "create_component" && result.path) {
          this.#layout.set(result.path, { x: 100, y: 100 });
        }
        if (op.kind === "delete_component") {
          const deleted = (op as { path: string }).path;
          this.#layout.delete(deleted);
          if (this.#selectedKey === deleted) this.#selectedKey = null;
        }
        await this.recompile();
        return true;
      },
      restore: (snapshot) => this.restoreHarness(snapshot),
      isEqual: (a, b) =>
        a.primaryContent === b.primaryContent &&
        JSON.stringify(a.layout) === JSON.stringify(b.layout) &&
        JSON.stringify(a.diagrams) === JSON.stringify(b.diagrams),
    });
    const applied = await this.transactions.execute(tx);
    if (!applied && !lenient) {
      throw new Error(`Transaction refused: ${label}`);
    }
    return applied;
  }

  /** Layout-only mutation as one undoable transaction. */
  private async executeLayoutTransaction(
    label: string,
    mutate: () => void,
  ): Promise<boolean> {
    const tx = snapshotTransaction({
      label,
      snapshot: () => this.snapshotHarness(),
      apply: async () => {
        mutate();
        await this.recompile();
        return true;
      },
      restore: (snapshot) => this.restoreHarness(snapshot),
    });
    return this.transactions.execute(tx);
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
      throw new Error(
        `referential-integrity: active diagram ${this.#activeDiagram} does not resolve`,
      );
    }
    for (const key of this.#layout.keys()) {
      if (!this.componentKeys.includes(key)) {
        throw new Error(
          `referential-integrity: layout component ${key} does not resolve`,
        );
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

  editableComponentKeys(): string[] {
    // The current diagram mutation path rewrites one primary HCL file.
    // Multi-file projects and Apollo's sourced component instances require
    // source-aware editing; flattening a resolved sourced instance back into
    // the usage site would violate E011. Those fixtures still participate in
    // compile/round-trip invariants, but generated visual edits are limited to
    // fixtures the current UI writer can safely round-trip.
    if (this.#sources.length !== 1 || this.#fixture === "apollo-11") return [];
    // Only visual *owners* are safe to mutate in isolation. An instance's
    // visuals are cloned from the definition it `source`s, so editing an
    // instance (or a definition that is instantiated) rewrites a shared
    // definition and changes every component in that group. Owners are the
    // components that carry their own visuals (no `source`).
    return this.componentKeys.filter((_key, index) =>
      !this.#components[index]?.source
    );
  }

  /**
   * Visual-owner snapshots, keyed by the component that owns them.
   *
   * An instance's visuals are cloned from the top-level definition it
   * `source`s, so the definition — not the instance — is the owner. Sourced
   * instances are therefore omitted: editing their definition changes the
   * whole group at once, and the owner entry already captures that state.
   */
  componentVisuals(): Record<string, ComponentVisualSnapshot> {
    const visuals: Record<string, ComponentVisualSnapshot> = {};
    this.#components.forEach((component, index) => {
      if (component.source) return;
      const key = this.#componentKeys[index] ?? `#${String(index)}`;
      visuals[key] = {
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
      this.#componentKeys = [];
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
    this.#componentKeys = model.component_keys();
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
    return {
      canonicalHcl: serialize_model(model),
      componentKeys: model.component_keys().toSorted(),
    };
  }

  async setSelectedComponentVisuals(
    patch: Pick<Partial<ComponentData>, "color" | "border" | "font" | "icon">,
  ): Promise<void> {
    const selectedKey = this.selectedComponentKey;
    if (!selectedKey) throw new Error("No component selected");
    const applied = await this.executeModelTransaction(
      `visual ${selectedKey}`,
      { kind: "update_component", path: selectedKey, patch },
      selectedKey,
    );
    if (!applied) {
      const primary = await this.primaryHclFile();
      throw new Error(`Component ${selectedKey} not found in ${primary}`);
    }
  }

  private async primaryHclFile(): Promise<string> {
    const entries = await this.fs.readdir(".", { recursive: true });
    const files = entries.filter((entry) =>
      entry.isFile() && entry.name.endsWith(".hcl") &&
      !entry.path.startsWith("views/")
    );
    const preferred = ["system.hcl", "systems.hcl", "main.hcl", "project.hcl"]
      .map((name) => files.find((entry) => entry.name === name))
      .find((entry) => entry !== undefined);
    return preferred?.path ?? files[0]?.path ?? "main.hcl";
  }
}
