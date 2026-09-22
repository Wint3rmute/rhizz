// A pure, dependency-free action log for the model editor.
//
// Every durable model mutation the UI performs is recorded here as a
// `ModelAction` — a faithful, ordered description of the ops the dispatcher
// executed. The log can be turned into a self-contained TypeScript test body
// (`asTestScript`) that replays the same op sequence through
// `applyModelMutation` against an in-memory file map, which is how a bug
// report becomes a reproduction: copy the console block into a `*.test.ts`,
// run it, and the failing state is rebuilt deterministically.
//
// The `ModelAction` union mirrors rhizz-core's `LoggedAction` variant for
// variant — Rust owns the write path (`applyModelMutation` → `apply_model_op`)
// and reports what it did, so a variant here that Rust never emits would be
// dead weight.
//
// Deliberately has zero dependency on Svelte or the WASM runtime, so this
// module is unit-testable in plain Node and reusable from the copy button and
// the simulation harness alike.

import type { ComponentData, PortData } from "./modelView";

// The subset of a component's fields the UI can mutate through the inspector
// / keyboard shortcuts. Kept as a plain object so it can be JSON-serialized
// and diffed for the `update_component` codegen.
export type ComponentPatch = Partial<
  Pick<
    ComponentData,
    | "full_name"
    | "icon"
    | "color"
    | "border"
    | "font"
    | "tags"
    | "leaf"
    | "ports"
  >
>;

export type ModelAction =
  | { op: "add_system"; label: string; full_name: string }
  | {
    op: "add_component_definition";
    label: string;
    leaf: boolean;
    full_name: string;
    tags: string[];
    icon?: string | undefined;
    color?: string | undefined;
    border?: string | undefined;
    font?: string | undefined;
    ports: PortData[];
  }
  | {
    op: "add_instance";
    parentPath: string;
    label: string;
    source: string;
  }
  | { op: "rename_component"; path: string; newLabel: string }
  | { op: "delete_component"; path: string }
  | { op: "reparent_component"; sourcePath: string; targetParentPath: string }
  | { op: "update_component"; path: string; patch: ComponentPatch }
  | {
    op: "add_connection";
    scopePath: string;
    label: string;
    from: string;
    to: string;
  }
  | { op: "delete_connection"; scopePath: string; label: string };

export interface ActionLog {
  /** Appends an action to the log. */
  record(action: ModelAction): void;
  /** Clears the log (e.g. when a new project is loaded). */
  clear(): void;
  /** The actions recorded so far, in order. */
  actions(): readonly ModelAction[];
}

export function createActionLog(): ActionLog {
  const actions: ModelAction[] = [];
  return {
    record(action) {
      actions.push(action);
    },
    clear() {
      actions.length = 0;
    },
    actions() {
      return actions;
    },
  };
}

// ── Code generation ──────────────────────────────────────────────────────────

// JSON.stringify produces a valid, safely-escaped TS/JS string literal for
// every string (including quotes, backslashes, newlines, unicode).
function tsString(s: string): string {
  return JSON.stringify(s);
}

// Renders a multi-line document (HCL) as a readable backtick template literal
// rather than a JSON.stringify-escaped single line (which would escape every
// newline into \n and bury the content on one line). Newlines inside a template
// literal are preserved as-is, so the emitted source stays as readable as the
// HCL itself. Backticks and ${ are escaped so the literal is unambiguous.
function tsTemplate(s: string): string {
  return `\`${
    s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
  }\``;
}

// Renders a single `ModelAction` as one `applyModelMutation` call against
// an in-memory file map. Every action the Rust dispatcher reports has a
// model-op equivalent, so the trace replays 1:1.
export function encodeCall(action: ModelAction, fileVar: string): string {
  return `await applyModelMutation(${fileVar}, "system.hcl", await ${fileVar}.readFile("system.hcl"), ${
    JSON.stringify(toMutationOp(action))
  });`;
}

function toMutationOp(action: ModelAction): unknown {
  switch (action.op) {
    case "add_system":
      return {
        kind: "add_system",
        label: action.label,
        full_name: action.full_name,
      };
    case "add_component_definition": {
      const options: {
        leaf: boolean;
        full_name: string;
        tags: string[];
        ports: PortData[];
        icon?: string;
        color?: string;
        border?: string;
        font?: string;
      } = {
        leaf: action.leaf,
        full_name: action.full_name,
        tags: action.tags,
        ports: action.ports,
      };
      if (action.icon !== undefined) options.icon = action.icon;
      if (action.color !== undefined) options.color = action.color;
      if (action.border !== undefined) options.border = action.border;
      if (action.font !== undefined) options.font = action.font;
      return { kind: "add_component_definition", label: action.label, options };
    }
    case "add_instance":
      return {
        kind: "add_instance",
        parentPath: action.parentPath,
        label: action.label,
        source: action.source,
      };
    case "rename_component":
      return {
        kind: "rename_component",
        path: action.path,
        newLabel: action.newLabel,
      };
    case "delete_component":
      return { kind: "delete_component", path: action.path };
    case "reparent_component":
      return {
        kind: "reparent_component",
        sourcePath: action.sourcePath,
        targetParentPath: action.targetParentPath,
      };
    case "update_component":
      return {
        kind: "update_component",
        path: action.path,
        patch: action.patch,
      };
    case "add_connection":
      return {
        kind: "add_connection",
        scopePath: action.scopePath,
        label: action.label,
        from: action.from,
        to: action.to,
      };
    case "delete_connection":
      // The dispatcher resolves the scope itself; the recorded scope is
      // redundant for replay.
      return { kind: "delete_connection_by_label", label: action.label };
  }
}

// ── Test-script generation ───────────────────────────────────────────────────

// Renders the whole log as a self-contained Vitest test. The emitted script
// seeds an in-memory `system.hcl` with the pre-session baseline, replays
// every recorded action through `applyModelMutation` (real Rust execution,
// real canonical writes), and asserts the file matches the traced final
// state. Copying the block into a `*.test.ts` reproduces the exact model
// state (and any bug that depends on it).
export function asTestScript(
  actions: readonly ModelAction[],
  finalHcl: string,
  opts: { testName?: string; baselineHcl?: string } = {},
): string {
  const testName = opts.testName ?? "replays the traced model-editor session";
  const baseline = opts.baselineHcl ?? "";
  const lines: string[] = [
    `import { beforeAll, describe, expect, it } from "vitest";`,
    `import init from "rhizz";`,
    `import * as nodeFs from "node:fs/promises";`,
    `import * as nodePath from "node:path";`,
    `import { applyModelMutation } from "./history/applyMutation";`,
    ``,
    `beforeAll(async () => {`,
    `  const wasmPath = nodePath.resolve(`,
    `    __dirname,`,
    `    "../../crates/rhizz-wasm/pkg/rhizz_wasm_bg.wasm",`,
    `  );`,
    `  const buffer = await nodeFs.readFile(wasmPath);`,
    `  await init({ module_or_path: buffer });`,
    `});`,
    ``,
    `describe("model editor replay", () => {`,
    `  it(${tsString(testName)}, async () => {`,
    `    const files = new Map<string, string>([["system.hcl", ${
      tsTemplate(baseline)
    }]]);`,
    `    const fs = {`,
    `      readFile: (filePath: string) =>`,
    `        Promise.resolve(files.get(filePath) ?? ""),`,
    `      writeFile: (filePath: string, content: string) => {`,
    `        files.set(filePath, content);`,
    `        return Promise.resolve();`,
    `      },`,
    `    };`,
  ];
  for (const action of actions) {
    lines.push(`    ${encodeCall(action, "fs")}`);
  }
  lines.push(
    `    expect(files.get("system.hcl")).toBe(${tsTemplate(finalHcl)});`,
    `  });`,
    `});`,
    ``,
  );
  return lines.join("\n");
}
