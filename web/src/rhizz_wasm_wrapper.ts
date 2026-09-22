import {
  apply_model_op as wasm_apply_model_op,
  CompileResultJS,
  get_example_projects as wasm_get_example_projects,
  type ModelJS,
  parse_views as wasm_parse_views,
  serialize_model as wasm_serialize_model,
  serialize_views as wasm_serialize_views,
} from "rhizz";
import type { ModelAction } from "./actionLog";

export interface NodeLayout {
  component: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text_align?: string;
}

export interface ConnectionLayout {
  connection: string;
  start_side?: string;
  end_side?: string;
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
 * The strings are exactly what `rhizz_core::WarningLevel::from_str` accepts
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

export interface ApplyModelOpResult {
  applied: boolean;
  hcl?: string;
  path?: string;
  actions: ModelAction[];
  diagnostics: MutationDiagnostic[];
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

export function get_example_projects(): ExampleProject[] {
  return wasm_get_example_projects() as ExampleProject[];
}
