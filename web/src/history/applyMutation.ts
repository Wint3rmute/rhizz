// Single entry point for all UI-driven model mutations.
// Execution lives in Rust: the op is sent verbatim to `apply_model_op`
// (`rhizz-core::mutate_to_hcl` via WASM), which parses the primary file,
// applies the op to the raw tree, resolves, and returns canonical HCL plus
// logged actions. Refusals (parse errors, guard failures, resolve errors)
// come back as `{ applied: false, diagnostics }` and leave the file
// untouched — the failure gate is the resolver itself, not a second
// TypeScript model. Reported actions are forwarded to the mutation observers
// so the action log sees exactly what the old store calls emitted.
//
// The UI reads the model back through `modelView.ts`, a flat projection of
// the compiled model — there is no second TypeScript model to keep in sync.

import { type ComponentData, type PortData } from "../modelView";
import { recordModelAction } from "../mutationObserver";
import { apply_model_op } from "../rhizz_wasm_wrapper";

// Minimal filesystem surface the dispatcher needs; `ProjectFs` satisfies it
// structurally.
export interface ModelFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface ComponentDefinitionOptions {
  leaf?: boolean;
  full_name?: string;
  tags?: string[];
  icon?: string;
  color?: string;
  border?: "solid" | "dashed" | "dotted";
  font?: string;
  ports?: PortData[];
}

// Declarative model mutations, one per capability the diagram canvas offers. `create_component` / `delete_connection_by_label` are the
// two higher-level ops whose container/scope resolution used to live inline
// in their handlers.
export type ModelMutationOp =
  | { kind: "add_system"; label: string; full_name?: string }
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
    full_name?: string;
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

export async function applyModelMutation(
  fs: ModelFileSystem,
  primaryPath: string,
  baselineContent: string,
  op: ModelMutationOp,
): Promise<ApplyMutationResult> {
  let result;
  try {
    // The op JSON matches the Rust `ModelOp` schema field-for-field, so it
    // passes through verbatim — no translation layer to drift.
    result = apply_model_op(primaryPath, baselineContent, op);
  } catch (error) {
    console.warn(`Model mutation (${op.kind}) failed to serialize`, error);
    return { applied: false };
  }
  if (!result.applied) {
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    console.warn(
      `Refusing model mutation (${op.kind}): ${
        codes.join(", ") || "guard refusal"
      }`,
    );
    return { applied: false };
  }
  if (result.hcl === undefined) {
    console.warn(`Model mutation (${op.kind}) returned no HCL`);
    return { applied: false };
  }
  await fs.writeFile(primaryPath, result.hcl);
  for (const action of result.actions) recordModelAction(action);
  if (result.path === undefined) return { applied: true };
  return { applied: true, path: result.path };
}
