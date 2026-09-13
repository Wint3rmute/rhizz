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
// Deliberately has zero dependency on Svelte or the WASM runtime (see
// DocumentStore.svelte.ts — importing it does not initialize WASM), so this
// module is unit-testable in plain Node and reusable from the console writer,
// the copy button, and the simulation harness alike.

import type { ComponentData, PortData } from "./DocumentStore.svelte";

// The subset of a component's fields the UI can mutate through the inspector
// / keyboard shortcuts. Kept as a plain object so it can be JSON-serialized
// and diffed for the `update_component` codegen.
export type ComponentPatch = Partial<
  Pick<
    ComponentData,
    | "description"
    | "icon"
    | "color"
    | "border"
    | "font"
    | "tags"
    | "leaf"
    | "ports"
  >
>;

export type ConnectionSide = "top" | "bottom" | "left" | "right";

export interface NodeLayoutPatch {
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  text_align?: string | undefined;
}

export type ModelAction =
  | { op: "new_project"; name: string; version: string; authors: string[] }
  | { op: "add_system"; label: string; description: string }
  | {
    op: "add_component_definition";
    label: string;
    leaf: boolean;
    description: string;
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
  | { op: "delete_connection"; scopePath: string; label: string }
  | { op: "add_port"; compPath: string; port: PortData }
  | {
    op: "update_port";
    compPath: string;
    portLabel: string;
    patch: Partial<PortData>;
  }
  | { op: "delete_port"; compPath: string; portLabel: string }
  | { op: "add_protocol"; label: string; description: string }
  | { op: "delete_protocol"; label: string }
  | { op: "add_view"; label: string; system: string }
  | {
    op: "update_node_layout";
    viewLabel: string;
    componentKey: string;
    layout: NodeLayoutPatch;
  };

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
// an in-memory file map. The emitted op mirrors the recorded action 1:1 so
// the trace stays honest to the edit it reflects. Actions with no model-op
// equivalent (project seeding, ports/protocols edited outside the canvas,
// view layout) become comment lines so replay scripts stay runnable.
export function encodeCall(action: ModelAction, fileVar: string): string {
  const op = toMutationOp(action);
  if (op === null) {
    return `// ${action.op} is not replayable through model ops (no-op in replay)`;
  }
  return `await applyModelMutation(${fileVar}, "system.hcl", await ${fileVar}.readFile("system.hcl"), ${JSON.stringify(op)});`;
}

function toMutationOp(action: ModelAction): unknown {
  switch (action.op) {
    case "add_system":
      return {
        kind: "add_system",
        label: action.label,
        description: action.description,
      };
    case "add_component_definition": {
      const options: Record<string, unknown> = {
        leaf: action.leaf,
        description: action.description,
        tags: action.tags,
        ports: action.ports,
      };
      if (action.icon !== undefined) options["icon"] = action.icon;
      if (action.color !== undefined) options["color"] = action.color;
      if (action.border !== undefined) options["border"] = action.border;
      if (action.font !== undefined) options["font"] = action.font;
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
      return { kind: "rename_component", path: action.path, newLabel: action.newLabel };
    case "delete_component":
      return { kind: "delete_component", path: action.path };
    case "reparent_component":
      return {
        kind: "reparent_component",
        sourcePath: action.sourcePath,
        targetParentPath: action.targetParentPath,
      };
    case "update_component":
      return { kind: "update_component", path: action.path, patch: action.patch };
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
    case "new_project":
    case "add_port":
    case "update_port":
    case "delete_port":
    case "add_protocol":
    case "delete_protocol":
    case "add_view":
    case "update_node_layout":
      return null;
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
    `    const files = new Map<string, string>([["system.hcl", ${tsTemplate(baseline)}]]);`,
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
