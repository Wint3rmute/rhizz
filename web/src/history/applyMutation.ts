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
import type {
  ConnectEnd,
  ConnectionPatch,
  ModelAction,
  ProtocolPatch,
  SystemPatch,
} from "../actionLog";
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
  | { kind: "update_system"; path: string; patch: SystemPatch }
  | { kind: "delete_component"; path: string }
  | { kind: "delete_system"; path: string }
  | {
      kind: "add_connection";
      scopePath: string;
      label: string;
      from: string;
      to: string;
    }
  | {
      // A connection together with the ports it ends on (and optionally a
      // stub protocol for them): one gesture, one atomic op.
      kind: "connect_components";
      scopePath: string;
      label: string;
      from: ConnectEnd;
      to: ConnectEnd;
      createProtocol?: string | undefined;
    }
  | { kind: "delete_connection"; scopePath: string; label: string }
  | {
      kind: "delete_connection_by_label";
      label: string;
      /** Also delete the endpoint ports no other connection uses. */
      removePorts?: boolean;
    }
  | {
      kind: "update_connection";
      scopePath: string;
      label: string;
      patch: ConnectionPatch;
    }
  | { kind: "add_protocol"; label: string; options?: ProtocolPatch }
  | { kind: "update_protocol"; path: string; patch: ProtocolPatch }
  | { kind: "delete_protocol"; path: string };

export interface ApplyMutationResult {
  applied: boolean;
  /** Path of the created component (`create_component` only). */
  path?: string;
  /** Why the op was refused (`applied: false` only): the resolver's error messages, for the user. */
  refusal?: string;
}

type MutationPlan =
  | {
      ok: true;
      hcl: string;
      path: string | undefined;
      actions: ModelAction[];
    }
  | { ok: false; refusal: string };

// Runs the op in Rust against the baseline without touching the file. Shared
// by the write path and the dry-run check, so both give the same verdict.
function planModelMutation(
  primaryPath: string,
  baselineContent: string,
  op: ModelMutationOp,
): MutationPlan {
  const fallback = "the change would leave the model invalid";
  let result;
  try {
    // The op JSON matches the Rust `ModelOp` schema field-for-field, so it
    // passes through verbatim — no translation layer to drift.
    result = apply_model_op(primaryPath, baselineContent, op);
  } catch (error) {
    console.warn(`Model mutation (${op.kind}) failed to serialize`, error);
    return { ok: false, refusal: fallback };
  }
  if (!result.applied) {
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    console.warn(
      `Refusing model mutation (${op.kind}): ${
        codes.join(", ") || "guard refusal"
      }`,
    );
    // Errors only: warnings ride along on a refusal but do not cause it.
    const errors = result.diagnostics
      .filter((diagnostic) => diagnostic.code.startsWith("E"))
      .map((diagnostic) => diagnostic.message);
    return { ok: false, refusal: errors.join("; ") || fallback };
  }
  if (result.hcl === undefined) {
    console.warn(`Model mutation (${op.kind}) returned no HCL`);
    return { ok: false, refusal: fallback };
  }
  return {
    ok: true,
    hcl: result.hcl,
    path: result.path,
    actions: result.actions,
  };
}

/**
 * Dry run: returns why `op` would be refused, or `undefined` when it would
 * apply. Never writes, so a caller can reject an op before asking the user
 * to confirm it.
 */
export function checkModelMutation(
  primaryPath: string,
  baselineContent: string,
  op: ModelMutationOp,
): string | undefined {
  const plan = planModelMutation(primaryPath, baselineContent, op);
  return plan.ok ? undefined : plan.refusal;
}

export async function applyModelMutation(
  fs: ModelFileSystem,
  primaryPath: string,
  baselineContent: string,
  op: ModelMutationOp,
): Promise<ApplyMutationResult> {
  const plan = planModelMutation(primaryPath, baselineContent, op);
  if (!plan.ok) return { applied: false, refusal: plan.refusal };
  await fs.writeFile(primaryPath, plan.hcl);
  for (const action of plan.actions) recordModelAction(action);
  if (plan.path === undefined) return { applied: true };
  return { applied: true, path: plan.path };
}
