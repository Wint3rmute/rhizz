import {
  CompileResultJS,
  type ModelJS,
  parse_views as wasm_parse_views,
  serialize_model as wasm_serialize_model,
  serialize_views as wasm_serialize_views,
} from "rhizz";

export interface NodeLayout {
  component: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text_align?: "center" | "top-center" | "top-left" | string;
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
  description?: string;
  tags?: string[];
  system: string;
  filter?: ViewFilterDefinition;
  nodes?: NodeLayout[];
}

export function compile_system(
  sources: { filename: string; content: string }[],
): CompileResultJS {
  return CompileResultJS.compile(sources);
}

export function serialize_model(model: ModelJS): string {
  return wasm_serialize_model(model);
}

export function serialize_views(views: ViewDefinition[]): string {
  return wasm_serialize_views(views);
}

export function parse_views(hcl: string): ViewDefinition[] {
  return wasm_parse_views(hcl) as ViewDefinition[];
}
