// A pure, dependency-free action log for the model editor.
//
// Every durable model / layout-persistence mutation the UI performs is
// recorded here as a `ModelAction` — a faithful, ordered description of the
// exact `DocumentStore` method calls that produced the current state. The log
// can be turned into a self-contained TypeScript test body (`asTestScript`)
// that replays the same sequence against a fresh `DocumentStore`, which is how
// a bug report becomes a reproduction: copy the console block into a
// `*.test.ts`, run it, and the failing state is rebuilt deterministically.
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
    op: "add_component";
    parentPath: string;
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

function tsStringArray(items: readonly string[]): string {
  return `[${items.map(tsString).join(", ")}]`;
}

function tsBool(b: boolean): string {
  return b ? "true" : "false";
}

// Renders a single `ModelAction` as one line of TypeScript that invokes the
// corresponding `DocumentStore` method on `projVar`. The emitted calls mirror
// the real mutator signatures 1:1 so the trace is honest to the edit it
// reflects and can be stepped through in a debugger.
export function encodeCall(action: ModelAction, projVar: string): string {
  switch (action.op) {
    case "new_project":
      return `${projVar}.setProject(${tsString(action.name)}, ${
        tsString(action.version)
      }, ${tsStringArray(action.authors)});`;
    case "add_system":
      return `${projVar}.addSystem(${tsString(action.label)}, ${
        tsString(action.description)
      });`;
    case "add_component": {
      const opts: string[] = [];
      if (action.leaf) opts.push(`leaf: true`);
      if (action.description !== "") {
        opts.push(`description: ${tsString(action.description)}`);
      }
      if (action.tags.length > 0) {
        opts.push(`tags: ${tsStringArray(action.tags)}`);
      }
      if (action.icon !== undefined) {
        opts.push(`icon: ${tsString(action.icon)}`);
      }
      if (action.color !== undefined) {
        opts.push(`color: ${tsString(action.color)}`);
      }
      if (action.border !== undefined) {
        opts.push(`border: ${tsString(action.border)}`);
      }
      if (action.font !== undefined) {
        opts.push(`font: ${tsString(action.font)}`);
      }
      if (action.ports.length > 0) {
        opts.push(`ports: [${action.ports.map(encodePort).join(", ")}]`);
      }
      return `${projVar}.addComponent(${tsString(action.parentPath)}, ${
        tsString(action.label)
      }${opts.length > 0 ? `, { ${opts.join(", ")} }` : ""});`;
    }
    case "rename_component":
      return `${projVar}.renameComponent(${tsString(action.path)}, ${
        tsString(action.newLabel)
      });`;
    case "delete_component":
      return `${projVar}.deleteComponent(${tsString(action.path)});`;
    case "reparent_component":
      return `${projVar}.reparentComponent(${tsString(action.sourcePath)}, ${
        tsString(action.targetParentPath)
      });`;
    case "update_component":
      return `${projVar}.updateComponent(${tsString(action.path)}, ${
        encodePatch(action.patch)
      });`;
    case "add_connection":
      return `${projVar}.addConnection(${
        tsString(action.scopePath)
      }, { label: ${tsString(action.label)}, from: ${
        tsString(action.from)
      }, to: ${tsString(action.to)} });`;
    case "delete_connection":
      return `${projVar}.deleteConnection(${tsString(action.scopePath)}, ${
        tsString(action.label)
      });`;
    case "add_port":
      return `${projVar}.addPort(${tsString(action.compPath)}, ${
        tsString(action.port.label)
      }, ${tsString(action.port.protocol ?? "")}, ${
        tsString(action.port.role)
      }, ${tsBool(action.port.external ?? false)}, ${
        tsBool(action.port.required ?? true)
      });`;
    case "update_port":
      return `${projVar}.updatePort(${tsString(action.compPath)}, ${
        tsString(action.portLabel)
      }, ${encodePatch(action.patch)});`;
    case "delete_port":
      return `${projVar}.deletePort(${tsString(action.compPath)}, ${
        tsString(action.portLabel)
      });`;
    case "add_protocol":
      return `${projVar}.addProtocol(${tsString(action.label)}, ${
        tsString(action.description)
      });`;
    case "delete_protocol":
      return `${projVar}.deleteProtocol(${tsString(action.label)});`;
    case "add_view":
      return `${projVar}.addView(${tsString(action.label)}, ${
        tsString(action.system)
      });`;
    case "update_node_layout":
      return `${projVar}.updateNodeLayout(${tsString(action.viewLabel)}, ${
        tsString(action.componentKey)
      }, ${encodeLayout(action.layout)});`;
  }
}

function encodePort(port: PortData): string {
  const opts: string[] = [`label: ${tsString(port.label)}`];
  if (port.description) opts.push(`description: ${tsString(port.description)}`);
  if (port.protocol) opts.push(`protocol: ${tsString(port.protocol)}`);
  opts.push(`role: ${tsString(port.role)}`);
  if (port.external) opts.push(`external: true`);
  if (port.required === false) opts.push(`required: false`);
  if (port.tags && port.tags.length > 0) {
    opts.push(`tags: ${tsStringArray(port.tags)}`);
  }
  return `{ ${opts.join(", ")} }`;
}

function encodePatch(patch: Record<string, unknown>): string {
  const entries = Object.entries(patch).map(([key, value]) => {
    if (value === undefined) return `${key}: undefined`;
    if (typeof value === "boolean") return `${key}: ${tsBool(value)}`;
    if (typeof value === "number") return `${key}: ${String(value)}`;
    if (Array.isArray(value)) {
      if (
        value.length > 0 && typeof value[0] === "object" && value[0] !== null
      ) {
        return `${key}: [${
          value.map((v) => encodePort(v as PortData)).join(", ")
        }]`;
      }
      return `${key}: ${tsStringArray(value.map((v) => String(v)))}`;
    }
    return `${key}: ${tsString(value as string)}`;
  });
  return `{ ${entries.join(", ")} }`;
}

function encodeLayout(layout: NodeLayoutPatch): string {
  const entries: string[] = [
    `x: ${String(layout.x)}`,
    `y: ${String(layout.y)}`,
  ];
  if (layout.width !== undefined) {
    entries.push(`width: ${String(layout.width)}`);
  }
  if (layout.height !== undefined) {
    entries.push(`height: ${String(layout.height)}`);
  }
  if (layout.text_align !== undefined) {
    entries.push(`text_align: ${tsString(layout.text_align)}`);
  }
  return `{ ${entries.join(", ")} }`;
}

// ── Test-script generation ───────────────────────────────────────────────────

// Renders the whole log as a self-contained Vitest test body. The emitted
// script constructs a fresh `DocumentStore`, seeds it with the project's
// baseline HCL (the state before the traced session began — matching how the
// UI loads the primary file before each edit), replays every recorded action,
// and asserts the canonical `systemHcl` matches the state the traced session
// produced. Copying the block into a `*.test.ts` reproduces the exact model
// state (and any bug that depends on it).
export function asTestScript(
  actions: readonly ModelAction[],
  finalHcl: string,
  opts: { projVar?: string; testName?: string; baselineHcl?: string } = {},
): string {
  const projVar = opts.projVar ?? "project";
  const testName = opts.testName ?? "replays the traced model-editor session";
  const lines: string[] = [
    `import { describe, expect, it } from "vitest";`,
    `import { DocumentStore } from "./DocumentStore.svelte";`,
    ``,
    `describe("model editor replay", () => {`,
    `  it(${tsString(testName)}, () => {`,
    `    const ${projVar} = new DocumentStore();`,
  ];
  if (opts.baselineHcl !== undefined && opts.baselineHcl !== "") {
    lines.push(`    ${projVar}.loadFromHcl(${tsTemplate(opts.baselineHcl)});`);
  }
  for (const action of actions) {
    lines.push(`    ${encodeCall(action, projVar)}`);
  }
  lines.push(
    `    expect(${projVar}.systemHcl).toBe(${tsTemplate(finalHcl)});`,
    `  });`,
    `});`,
    ``,
  );
  return lines.join("\n");
}
