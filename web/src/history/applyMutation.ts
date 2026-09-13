// Single entry point for all UI-driven model mutations (audit Finding 1).
//
// Every canvas handler used to copy-paste the same pipeline:
//
//   read primary .hcl → new DocumentStore() → loadFromHcl()
//     → mutate the TS tree → doc.systemHcl → fs.writeFile → recompile
//
// with no failure gate: a primary file with blocking errors loaded into an
// empty store, and the next drag on the canvas overwrote it with a near-empty
// model. All handlers go through `applyModelMutation` instead, which compiles
// the baseline once, refuses when it has blocking errors, applies one
// declarative op via the `DocumentStore` API (so the mutation observer and
// the action log see exactly what the direct store calls would emit), and
// persists the Rust-canonical HCL.
//
// This is the TS-side dispatcher. The structural follow-up (Rust-owned
// mutations via `ModelJS`) re-targets these same ops behind this signature.

import {
  type ComponentData,
  DocumentStore,
  type PortData,
  type RawModelPayload,
} from "../DocumentStore.svelte";
import { compile_system } from "../rhizz_wasm_wrapper";
import { resolveInstanceStoreParent } from "./placement";

// Minimal filesystem surface the dispatcher needs; `ProjectFs` satisfies it
// structurally.
export interface ModelFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ComponentDefinitionOptions {
  leaf?: boolean;
  description?: string;
  tags?: string[];
  icon?: string;
  color?: string;
  border?: "solid" | "dashed" | "dotted";
  font?: string;
  ports?: PortData[];
}

// Declarative model mutations, one per `DocumentStore` capability used by the
// diagram canvas. `create_component` / `delete_connection_by_label` are the
// two higher-level ops whose container/scope resolution used to live inline
// in their handlers.
export type ModelMutationOp =
  | { kind: "add_system"; label: string; description?: string }
  | {
    kind: "add_component_definition";
    label: string;
    options?: ComponentDefinitionOptions;
  }
  | { kind: "add_instance"; parentPath: string; label: string; source: string }
  | {
    kind: "create_component";
    label: string;
    parentKey?: string;
    sourceLabel?: string;
    leaf?: boolean;
    description?: string;
    tags?: string[];
    ports?: PortData[];
  }
  | {
    kind: "reparent_component";
    sourcePath: string;
    targetParentPath: string;
  }
  | { kind: "rename_component"; path: string; newLabel: string }
  | { kind: "update_component"; path: string; patch: Partial<ComponentData> }
  | { kind: "delete_component"; path: string }
  | {
    kind: "add_connection";
    scopePath: string;
    label: string;
    from: string;
    to: string;
  }
  | { kind: "delete_connection"; scopePath: string; label: string }
  | { kind: "delete_connection_by_label"; label: string };

export interface ApplyMutationResult {
  applied: boolean;
  /** Path of the created component (`create_component` only). */
  path?: string;
}

// Locates the scope holding a connection label, searching systems then
// nested component bodies depth-first. Moved verbatim out of the
// delete-connection handler so handlers never walk the tree themselves.
export function findConnectionScope(
  doc: DocumentStore,
  label: string,
): string | null {
  for (const sys of doc.systems) {
    if (sys.connections.some((c) => c.label === label)) return sys.label;
    const nested = findConnectionScopeIn(sys.components, sys.label, label);
    if (nested !== null) return nested;
  }
  return null;
}

function findConnectionScopeIn(
  comps: ComponentData[],
  parentPath: string,
  label: string,
): string | null {
  for (const comp of comps) {
    const cur = `${parentPath}/${comp.label}`;
    if (comp.connections.some((c) => c.label === label)) return cur;
    const deeper = findConnectionScopeIn(comp.components, cur, label);
    if (deeper !== null) return deeper;
  }
  return null;
}

export async function applyModelMutation(
  fs: ModelFileSystem,
  primaryPath: string,
  baselineContent: string,
  op: ModelMutationOp,
): Promise<ApplyMutationResult> {
  // Failure gate: refuse when the on-disk baseline has blocking errors.
  // Loading it would yield an empty/partial store, and persisting that would
  // destroy the user's content. Warnings (W***) still pass — only a missing
  // model (E***) refuses. An empty baseline is a new file, not an error.
  const doc = new DocumentStore();
  if (baselineContent.trim()) {
    const baseline = compile_system([{
      filename: primaryPath,
      content: baselineContent,
    }]);
    const baselineModel = baseline.model();
    if (!baselineModel) {
      console.warn(
        `Refusing model mutation (${op.kind}): ${primaryPath} has blocking errors`,
      );
      return { applied: false };
    }
    doc.loadFromRawModel(baselineModel.to_js() as RawModelPayload);
  }

  let applied = false;
  let path: string | undefined;
  switch (op.kind) {
    case "add_system":
      doc.addSystem(op.label, op.description ?? "");
      applied = true;
      break;
    case "add_component_definition":
      doc.addComponentDefinition(op.label, op.options ?? {});
      applied = true;
      break;
    case "add_instance":
      applied = doc.addInstance(op.parentPath, op.label, op.source) !== null;
      path = `${op.parentPath}/${op.label}`;
      break;
    case "create_component": {
      let parent = op.parentKey ?? "";
      if (!parent || !doc.findContainer(parent)) {
        // Both modes need a real container: fall back to the first system,
        // creating a "main" system when the model has none yet.
        if (doc.systems.length === 0) {
          doc.addSystem("main", "Main system");
          parent = "main";
        } else {
          const first = doc.systems[0];
          parent = first ? first.label : "main";
        }
      }
      // Children of an instance persist in that instance's definition
      // body: instance blocks carry only `source` (E012), so nesting under
      // the instance itself would be silently dropped on write.
      const storeParent = resolveInstanceStoreParent(doc, parent);
      if (!op.sourceLabel) {
        // New-definition mode: create a top-level reusable definition (no
        // system parent, so it is available for instances from anywhere)
        // and immediately place an instance of it — otherwise creation
        // closes with nothing visibly changing on the canvas.
        doc.addComponentDefinition(op.label, {
          ...(op.leaf === undefined ? {} : { leaf: op.leaf }),
          ...(op.description === undefined
            ? {}
            : { description: op.description }),
          ...(op.tags === undefined ? {} : { tags: op.tags }),
          ...(op.ports === undefined ? {} : { ports: op.ports }),
        });
        doc.addInstance(storeParent, op.label, op.label);
      } else {
        doc.addInstance(storeParent, op.label, op.sourceLabel);
      }
      path = `${parent}/${op.label}`;
      applied = true;
      break;
    }
    case "reparent_component":
      applied = doc.reparentComponent(op.sourcePath, op.targetParentPath);
      break;
    case "rename_component":
      applied = doc.renameComponent(op.path, op.newLabel);
      break;
    case "update_component":
      applied = doc.updateComponent(op.path, op.patch);
      break;
    case "delete_component":
      applied = doc.deleteComponent(op.path);
      break;
    case "add_connection":
      applied = doc.addConnection(op.scopePath, {
        label: op.label,
        from: op.from,
        to: op.to,
      }) !== null;
      break;
    case "delete_connection":
      applied = doc.deleteConnection(op.scopePath, op.label);
      break;
    case "delete_connection_by_label": {
      const scope = findConnectionScope(doc, op.label);
      applied = scope !== null && doc.deleteConnection(scope, op.label);
      break;
    }
  }

  if (!applied) return { applied: false };
  const hcl = doc.canonicalHcl;
  if (hcl === null) {
    console.warn(
      `Refusing model write (${op.kind}): draft has blocking errors`,
    );
    return { applied: false };
  }
  await fs.writeFile(primaryPath, hcl);
  if (path === undefined) return { applied: true };
  return { applied: true, path };
}
