// TypeScript types mirroring rhizz-core's resolved model.
// These match the shape returned by compile_sources() via serde-wasm-bindgen.

export interface Source {
  filename: string;
  content: string;
}

export interface CompileResult {
  model: Model | null;
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  code: string;
  file: string;
  line: number | null;
  message: string;
}

export interface Model {
  project: Project;
  systems: System[];
  components: Component[];
  ports: Port[];
  connections: Connection[];
  messages: Message[];
  fields: Field[];
  views: View[];
}

export interface Project {
  name: string;
  version: string;
  authors: string[];
}

export interface System {
  label: string;
  description: string;
  tags: string[];
  level: number;
  components: number[];
  connections: number[];
}

export interface Component {
  label: string;
  description: string;
  tags: string[];
  level: number;
  leaf: boolean;
  parent: ComponentParent;
  children: number[];
  ports: number[];
  connections: number[];
}

export type ComponentParent =
  | { System: number }
  | { Component: number };

export interface Port {
  label: string;
  description: string;
  protocol: string;
  role: PortRole;
  tags: string[];
  owner: number;
  messages: number[];
}

export type PortRole = "Provider" | "Consumer" | "Peer";

export interface ConnectionEndpoint {
  component: number;
  port: number | null;
}

export interface Connection {
  label: string;
  description: string;
  tags: string[];
  level: number;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  encapsulates: number[];
}

export interface Message {
  label: string;
  description: string;
  tags: string[];
  level: number;
  fields: number[];
}

export interface Field {
  label: string;
  field_type: string;
  description: string;
  unit: string;
  required: boolean;
}

export interface View {
  label: string;
  description: string;
  tags: string[];
  system: number;
  filter: ViewFilter;
  output: ViewOutput;
}

export interface ViewFilter {
  include_tags: string[];
  exclude_tags: string[];
  max_level: number | null;
  components: string[];
  show_messages: boolean;
}

export interface ViewOutput {
  filename: string;
  rankdir: string;
}
