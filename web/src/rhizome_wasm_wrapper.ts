import {
  apply_model_op as wasm_apply_model_op,
  CompileResultJS,
  get_empty_project as wasm_get_empty_project,
  get_example_projects as wasm_get_example_projects,
  type ModelJS,
  parse_views as wasm_parse_views,
  rename_connections_in_views as wasm_rename_connections_in_views,
  rename_ports_in_views as wasm_rename_ports_in_views,
  serialize_model as wasm_serialize_model,
  serialize_views as wasm_serialize_views,
} from "rhizome";
import type { ModelAction } from "./actionLog";

export interface NodeLayout {
  component: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text_align?: string;
  /** Per-view port presentation: an outline spot (`side` + `offset`; absent
   * side means the role default applies) and/or `visible`, which shows the
   * port even when no drawn connection names it. */
  ports?: {
    port: string;
    side?: string | null;
    offset?: number;
    visible?: boolean;
  }[];
}

export interface ConnectionLayout {
  connection: string;
  hidden?: boolean;
}

export interface Annotation {
  text: string;
  x: number;
  y: number;
  /** Font size multiplier; 1 = 100% (default). */
  scale?: number;
}

export interface ViewFilterDefinition {
  include_tags?: string[];
  exclude_tags?: string[];
  max_level?: number;
  components?: string[];
  show_messages?: boolean;
}

export interface ViewDefinition {
  label: string;
  full_name?: string;
  tags?: string[];
  system: string;
  filter?: ViewFilterDefinition;
  nodes?: NodeLayout[];
  connections?: ConnectionLayout[];
  annotations?: Annotation[];
}

/**
 * A project-wide preset describing how much detail a project is specified at
 * (see `SPEC/warning-levels.md`). It gates which *warnings* the compiler
 * reports — errors are never gated — and every level reports at least as much
 * as the less detailed ones (`business` < `architectural` < `component`).
 *
 * The strings are exactly what `rhizome_core::WarningLevel::from_str` accepts
 * (it is case-insensitive, but the UI only ever produces these three).
 */
export type WarningLevel = "business" | "architectural" | "component";

/** Every warning level, ordered from least to most detailed. */
export const WARNING_LEVELS: readonly WarningLevel[] = [
  "business",
  "architectural",
  "component",
];

/** The most detailed level — reports every warning (the compiler default). */
export const DEFAULT_WARNING_LEVEL: WarningLevel = "component";

export function compile_system(
  sources: { filename: string; content: string }[],
  warning_level: WarningLevel = DEFAULT_WARNING_LEVEL,
): CompileResultJS {
  return CompileResultJS.compile_with_warning_level(sources, warning_level);
}

export function serialize_model(model: ModelJS): string {
  return wasm_serialize_model(model);
}

export interface MutationDiagnostic {
  code: string;
  message: string;
  file: string | null;
  line: number | null;
}

/** A port label that changed on one placed component (`rename_port`), keyed
 * like view nodes (`Model::component_keys`). */
export interface PortRename {
  component: string;
  from: string;
  to: string;
}

/** A connection label that changed (`rename_connection`), with the systems a
 * copy of it is placed in: views over those systems re-key their
 * `connection` blocks. */
export interface ConnectionRename {
  systems: string[];
  from: string;
  to: string;
}

export interface ApplyModelOpResult {
  applied: boolean;
  hcl?: string;
  path?: string;
  actions: ModelAction[];
  diagnostics: MutationDiagnostic[];
  /** Port labels that changed on placed components (`rename_port` only). */
  portRenames: PortRename[];
  /** Connection labels that changed (`rename_connection` only). */
  connectionRenames: ConnectionRename[];
}

/** Applies one declarative model mutation via Rust; refusals come back as
 * `{ applied: false, diagnostics }`, never thrown. */
export function apply_model_op(
  filename: string,
  content: string,
  op: unknown,
): ApplyModelOpResult {
  return wasm_apply_model_op(filename, content, op) as ApplyModelOpResult;
}

export function serialize_views(views: ViewDefinition[]): string {
  return wasm_serialize_views(views);
}

export function parse_views(hcl: string): ViewDefinition[] {
  return wasm_parse_views(hcl) as ViewDefinition[];
}

/** Re-keys one view file's `port` blocks after a port rename. `undefined`
 * when the file names none of the renamed ports (nothing to write). Throws
 * when the view HCL does not parse. */
export function rename_ports_in_views(
  hcl: string,
  renames: readonly PortRename[],
): string | undefined {
  return wasm_rename_ports_in_views(hcl, renames);
}

/** Re-keys one view file's `connection` blocks after a connection rename.
 * `undefined` when the file names none of the renamed connections (nothing
 * to write). Throws when the view HCL does not parse. */
export function rename_connections_in_views(
  hcl: string,
  renames: readonly ConnectionRename[],
): string | undefined {
  return wasm_rename_connections_in_views(hcl, renames);
}

export interface ExampleFile {
  path: string;
  content: string;
}

export interface ExampleProject {
  id: string;
  name: string;
  description: string;
  files: ExampleFile[];
}

/** Seed layout of a brand-new empty project (shared with the MCP server). */
export interface EmptyProject {
  main_file: string;
  main_content: string;
  dirs: string[];
}

export function get_empty_project(): EmptyProject {
  return wasm_get_empty_project() as EmptyProject;
}

export function get_example_projects(): ExampleProject[] {
  return wasm_get_example_projects() as ExampleProject[];
}
