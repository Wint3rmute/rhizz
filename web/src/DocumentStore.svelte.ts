// Centralized reactive document store for a Rhizz project.
// Holds mutable in-memory system architecture models and visual view layouts,
// automatically deriving canonical HCL representations, diagnostics, and scores.

import { SvelteSet } from "svelte/reactivity";
import {
  compile_system,
  type NodeLayout,
  parse_views,
  serialize_views,
  type ViewDefinition,
} from "./rhizz_wasm_wrapper";

export interface ProjectMetadata {
  name: string;
  version: string;
  authors: string[];
}

export interface FieldData {
  label: string;
  type: string;
  description?: string;
  unit?: string;
  required?: boolean | undefined;
}

export interface MessageData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number | undefined;
  fields: FieldData[];
}

export interface ProtocolData {
  label: string;
  description?: string;
  tags?: string[];
  roles?: ("provider" | "consumer" | "peer")[];
  messages: MessageData[];
}

export interface PortData {
  label: string;
  description?: string;
  protocol?: string;
  role: "provider" | "consumer" | "peer";
  external?: boolean | undefined;
  required?: boolean | undefined;
  tags?: string[];
}

export interface ConnectionData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number | undefined;
  from: string;
  to: string;
  encapsulates?: string[];
}

export interface ComponentData {
  label: string;
  /** The top-level definition this component was instantiated from via
   * `source = "..."`, if any; `undefined` for components carrying their body
   * inline. Used to serialize `source` references instead of inlining clones. */
  source?: string | undefined;
  description?: string;
  icon?: string | undefined;
  color?: string | undefined;
  border?: "solid" | "dashed" | "dotted" | undefined;
  font?: string | undefined;
  tags?: string[];
  level?: number | undefined;
  leaf: boolean;
  ports: PortData[];
  components: ComponentData[];
  connections: ConnectionData[];
}

export interface SystemData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number;
  components: ComponentData[];
  connections: ConnectionData[];
}

function escapeHclString(s: string): string {
  return JSON.stringify(s);
}

export function formatStringList(items?: string[]): string {
  if (!items || items.length === 0) return "[]";
  return `[${items.map((it) => escapeHclString(it)).join(", ")}]`;
}

// Resolves an arena index to its element, throwing if the reference is
// dangling. Arena indices come from the compiled Rust model which is always
// densely-populated, so an out-of-range index is a compiler/ingestion bug
// rather than a condition the UI should silently tolerate.
function arenaAt<T>(arena: T[], index: number): T {
  const el = arena[index];
  if (el === undefined) {
    throw new Error(
      `Arena index ${String(index)} is out of range (len ${
        String(arena.length)
      })`,
    );
  }
  return el;
}

export interface RawModelPayload {
  project?: {
    name?: string;
    version?: string;
    authors?: string[];
  };
  components?: {
    label: string;
    source?: string;
    description?: string;
    icon?: string;
    color?: string;
    border?: string;
    font?: string;
    tags?: string[];
    level?: number;
    leaf?: boolean;
    ports?: number[];
    children?: number[];
    connections?: number[];
  }[];
  protocols?: {
    label: string;
    description?: string;
    tags?: string[];
    roles?: string[];
    messages?: number[];
  }[];
  ports?: {
    label: string;
    description?: string;
    protocol?: string;
    role?: string;
    external?: boolean;
    required?: boolean;
    tags?: string[];
  }[];
  connections?: {
    label: string;
    description?: string;
    tags?: string[];
    level?: number;
    from: { component: number; port?: number | null };
    to: { component: number; port?: number | null };
    encapsulates?: number[];
  }[];
  messages?: {
    label: string;
    description?: string;
    tags?: string[];
    level?: number;
    fields?: number[];
  }[];
  fields?: {
    label: string;
    field_type?: string;
    description?: string;
    unit?: string;
    required?: boolean;
  }[];
  systems?: {
    label: string;
    description?: string;
    tags?: string[];
    level?: number;
    components?: number[];
    connections?: number[];
  }[];
}

export class DocumentStore {
  project = $state<ProjectMetadata>({
    name: "untitled",
    version: "0.1.0",
    authors: [],
  });

  protocols = $state<ProtocolData[]>([]);
  systems = $state<SystemData[]>([]);
  views = $state<ViewDefinition[]>([]);

  // ── Derived HCL text ─────────────────────────────────────────────────────────

  systemHcl = $derived.by(() => {
    const lines: string[] = [];

    // Project block
    if (
      this.project.name || this.project.version ||
      (this.project.authors.length > 0)
    ) {
      lines.push("project {");
      if (this.project.name) {
        lines.push(`  name    = ${escapeHclString(this.project.name)}`);
      }
      if (this.project.version && this.project.version !== "0.0.0") {
        lines.push(`  version = ${escapeHclString(this.project.version)}`);
      }
      if (this.project.authors.length > 0) {
        lines.push(`  authors = ${formatStringList(this.project.authors)}`);
      }
      lines.push("}\n");
    }

    // Protocol blocks
    const sortedProtocols = [...this.protocols].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const proto of sortedProtocols) {
      this.serializeProtocol(lines, proto);
      lines.push("");
    }

    // Component definitions: every component is emitted as a standalone
    // top-level block keyed by its definition label (its `source` label if it
    // is an instance of a shared definition, otherwise its qualified path), so
    // nothing is inlined under a parent. Systems and parent components
    // reference children via `source = "<label>"`. Sorted by the emitted label
    // and deduplicated so shared definitions are emitted once.
    const sortedSystems = [...this.systems].sort((a, b) =>
      a.label.localeCompare(b.label)
    );

    const allComponents: { sysLabel: string; comp: ComponentData }[] = [];
    for (const sys of sortedSystems) {
      this.collectComponents(sys.label, sys.components, allComponents);
    }
    allComponents.sort((a, b) =>
      this.componentLabel(a.sysLabel, a.comp).localeCompare(
        this.componentLabel(b.sysLabel, b.comp),
      )
    );

    const seenLabels = new SvelteSet<string>();
    for (const { sysLabel, comp } of allComponents) {
      const label = this.componentLabel(sysLabel, comp);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      lines.push("");
      this.serializeComponentDef(lines, sysLabel, comp);
    }

    // System blocks
    for (let i = 0; i < sortedSystems.length; i++) {
      const sys = arenaAt(sortedSystems, i);
      lines.push("");
      lines.push(`system ${escapeHclString(sys.label)} {`);
      if (sys.description) {
        lines.push(`  description = ${escapeHclString(sys.description)}`);
      }
      if (sys.tags && sys.tags.length > 0) {
        lines.push(`  tags        = ${formatStringList(sys.tags)}`);
      }
      if (sys.level !== undefined && sys.level !== 0) {
        lines.push(`  level       = ${String(sys.level)}`);
      }

      // Direct child components, referenced via source pointing at their
      // standalone top-level definition.
      const sortedComps = [...sys.components].sort((a, b) =>
        a.label.localeCompare(b.label)
      );
      for (const comp of sortedComps) {
        lines.push("");
        lines.push(`  component ${escapeHclString(comp.label)} {`);
        lines.push(
          `    source = ${
            escapeHclString(this.componentLabel(sys.label, comp))
          }`,
        );
        lines.push("  }");
      }

      // System-level connections
      const sortedConns = [...sys.connections].sort((a, b) =>
        a.label.localeCompare(b.label)
      );
      for (const conn of sortedConns) {
        lines.push("");
        this.serializeConnection(lines, conn, 1, sys.level ?? 0);
      }

      lines.push("}");
    }

    return lines.join("\n") + "\n";
  });

  viewsHcl = $derived.by(() => {
    return serialize_views(this.views);
  });

  // ── Derived Compilation & Diagnostics ───────────────────────────────────────

  compileResult = $derived.by(() => {
    return compile_system([{
      filename: "system.hcl",
      content: this.systemHcl,
    }]);
  });

  model = $derived.by(() => {
    return this.compileResult.model();
  });

  diagnostics = $derived.by(() => {
    return this.compileResult.diagnostics();
  });

  score = $derived.by(() => {
    return this.model?.score();
  });

  // ── Serialization Helpers ───────────────────────────────────────────────────

  // Recursively collects every component in a system (with its root system
  // label) so the flat serializer can emit them all as top-level definitions.
  private collectComponents(
    sysLabel: string,
    comps: ComponentData[],
    acc: { sysLabel: string; comp: ComponentData }[],
  ): void {
    for (const comp of comps) {
      acc.push({ sysLabel, comp });
      this.collectComponents(sysLabel, comp.components, acc);
    }
  }

  // Builds the qualified path of a component from its root system, e.g.
  // `airborne/plane/engine`. The system label is included so the path is
  // globally unique across systems.
  private componentPath(sysLabel: string, comp: ComponentData): string {
    const segments: string[] = [];
    let current: ComponentData | undefined = comp;
    while (current) {
      segments.unshift(current.label);
      // Find the parent component by searching the tree.
      current = this.findParentComponent(sysLabel, current);
    }
    segments.unshift(sysLabel);
    return segments.join("/");
  }

  // Returns the label under which a component's definition is emitted: its
  // `source` label when it is an instance of a shared definition, otherwise its
  // qualified path.
  private componentLabel(sysLabel: string, comp: ComponentData): string {
    return comp.source ?? this.componentPath(sysLabel, comp);
  }

  // Finds the parent ComponentData of `comp` within `sysLabel`, or undefined
  // if `comp` is a direct child of the system.
  private findParentComponent(
    sysLabel: string,
    comp: ComponentData,
  ): ComponentData | undefined {
    const sys = this.getSystem(sysLabel);
    if (!sys) return undefined;
    const search = (list: ComponentData[]): ComponentData | undefined => {
      for (const c of list) {
        if (c.components.includes(comp)) return c;
        const found = search(c.components);
        if (found) return found;
      }
      return undefined;
    };
    return search(sys.components);
  }

  // Serializes a single component as a standalone top-level definition keyed
  // by its definition label (source label or qualified path). Children are
  // referenced via `source` pointing at their own standalone definitions rather
  // than inlined.
  private serializeComponentDef(
    lines: string[],
    sysLabel: string,
    comp: ComponentData,
  ) {
    lines.push(
      `component ${escapeHclString(this.componentLabel(sysLabel, comp))} {`,
    );
    const inner = "  ";

    if (comp.description) {
      lines.push(`${inner}description = ${escapeHclString(comp.description)}`);
    }
    if (comp.icon) {
      lines.push(`${inner}icon        = ${escapeHclString(comp.icon)}`);
    }
    if (comp.color) {
      lines.push(`${inner}color       = ${escapeHclString(comp.color)}`);
    }
    if (comp.border && comp.border !== "solid") {
      lines.push(`${inner}border      = ${escapeHclString(comp.border)}`);
    }
    if (comp.font) {
      lines.push(`${inner}font        = ${escapeHclString(comp.font)}`);
    }
    if (comp.tags && comp.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(comp.tags)}`);
    }
    if (comp.level !== undefined && comp.level !== 1) {
      lines.push(`${inner}level       = ${String(comp.level)}`);
    }
    if (comp.leaf) lines.push(`${inner}leaf        = true`);

    // Ports
    const sortedPorts = [...comp.ports].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const port of sortedPorts) {
      lines.push("");
      this.serializePort(lines, port, 1);
    }

    // Child components, referenced via source pointing at their own standalone
    // top-level definition.
    const sortedChildren = [...comp.components].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const child of sortedChildren) {
      lines.push("");
      lines.push(`  component ${escapeHclString(child.label)} {`);
      lines.push(
        `    source = ${escapeHclString(this.componentLabel(sysLabel, child))}`,
      );
      lines.push("  }");
    }

    // Sub-connections
    const sortedConns = [...comp.connections].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const conn of sortedConns) {
      lines.push("");
      this.serializeConnection(lines, conn, 1, comp.level ?? 1);
    }

    lines.push("}");
  }

  private serializeProtocol(lines: string[], proto: ProtocolData) {
    lines.push(`protocol ${escapeHclString(proto.label)} {`);
    const inner = "  ";

    if (proto.description) {
      lines.push(`${inner}description = ${escapeHclString(proto.description)}`);
    }
    if (proto.tags && proto.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(proto.tags)}`);
    }
    if (proto.roles && proto.roles.length > 0) {
      lines.push(`${inner}roles       = ${formatStringList(proto.roles)}`);
    }

    const sortedMsgs = [...proto.messages].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const msg of sortedMsgs) {
      lines.push("");
      this.serializeMessage(lines, msg, 1, 0);
    }

    lines.push("}");
  }

  private serializePort(
    lines: string[],
    port: PortData,
    depth: number,
  ) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}port ${escapeHclString(port.label)} {`);
    const inner = "  ".repeat(depth + 1);

    if (port.description) {
      lines.push(`${inner}description = ${escapeHclString(port.description)}`);
    }
    if (port.protocol) {
      lines.push(`${inner}protocol    = ${escapeHclString(port.protocol)}`);
    }
    lines.push(`${inner}role        = ${escapeHclString(port.role)}`);
    if (port.tags && port.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(port.tags)}`);
    }
    if (port.external) {
      lines.push(`${inner}external    = true`);
    }
    if (port.required === false) {
      lines.push(`${inner}required    = false`);
    }

    lines.push(`${indent}}`);
  }

  private serializeMessage(
    lines: string[],
    msg: MessageData,
    depth: number,
    parentLevel: number,
  ) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}message ${escapeHclString(msg.label)} {`);
    const inner = "  ".repeat(depth + 1);

    if (msg.description) {
      lines.push(`${inner}description = ${escapeHclString(msg.description)}`);
    }
    if (msg.tags && msg.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(msg.tags)}`);
    }
    if (msg.level !== undefined && msg.level !== parentLevel) {
      lines.push(`${inner}level       = ${String(msg.level)}`);
    }

    const sortedFields = [...msg.fields].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const f of sortedFields) {
      lines.push("");
      this.serializeField(lines, f, depth + 1);
    }

    lines.push(`${indent}}`);
  }

  private serializeField(lines: string[], field: FieldData, depth: number) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}field ${escapeHclString(field.label)} {`);
    const inner = "  ".repeat(depth + 1);

    lines.push(
      `${inner}type        = ${escapeHclString(field.type || "string")}`,
    );
    if (field.description) {
      lines.push(`${inner}description = ${escapeHclString(field.description)}`);
    }
    if (field.unit) {
      lines.push(`${inner}unit        = ${escapeHclString(field.unit)}`);
    }
    if (field.required) lines.push(`${inner}required    = true`);

    lines.push(`${indent}}`);
  }

  private serializeConnection(
    lines: string[],
    conn: ConnectionData,
    depth: number,
    parentLevel: number,
  ) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}connection ${escapeHclString(conn.label)} {`);
    const inner = "  ".repeat(depth + 1);

    if (conn.description) {
      lines.push(`${inner}description  = ${escapeHclString(conn.description)}`);
    }
    if (conn.tags && conn.tags.length > 0) {
      lines.push(`${inner}tags         = ${formatStringList(conn.tags)}`);
    }
    if (conn.level !== undefined && conn.level !== parentLevel + 1) {
      lines.push(`${inner}level        = ${String(conn.level)}`);
    }
    lines.push(`${inner}from         = ${escapeHclString(conn.from)}`);
    lines.push(`${inner}to           = ${escapeHclString(conn.to)}`);

    if (conn.encapsulates && conn.encapsulates.length > 0) {
      const sortedEnc = [...conn.encapsulates].sort();
      lines.push(`${inner}encapsulates = ${formatStringList(sortedEnc)}`);
    }

    lines.push(`${indent}}`);
  }

  // ── Foundational Store Mutations ────────────────────────────────────────────

  setProject(name: string, version = "0.1.0", authors: string[] = []) {
    this.project = { name, version, authors };
  }

  addSystem(label: string, description = ""): SystemData {
    const existing = this.systems.find((s) => s.label === label);
    if (existing) return existing;
    const sys: SystemData = {
      label,
      description,
      tags: [],
      level: 0,
      components: [],
      connections: [],
    };
    this.systems.push(sys);
    return sys;
  }

  removeSystem(label: string): boolean {
    const idx = this.systems.findIndex((s) => s.label === label);
    if (idx !== -1) {
      this.systems.splice(idx, 1);
      return true;
    }
    return false;
  }

  getSystem(label: string): SystemData | undefined {
    return this.systems.find((s) => s.label === label);
  }

  // Finds a component container by path (e.g. "quad" -> SystemData, or "quad/fc" -> ComponentData)
  findContainer(
    path: string,
  ): { sys: SystemData; parentComp?: ComponentData } | null {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const firstPart = parts[0];
    if (firstPart === undefined) return null;
    const sys = this.getSystem(firstPart);
    if (!sys) return null;

    if (parts.length === 1) {
      return { sys };
    }

    let current: ComponentData | undefined;
    let comps = sys.components;

    for (let i = 1; i < parts.length; i++) {
      const segment = parts[i];
      current = comps.find((c) => c.label === segment);
      if (!current) return null;
      comps = current.components;
    }

    return current ? { sys, parentComp: current } : null;
  }

  findComponent(path: string): ComponentData | null {
    const container = this.findContainer(path);
    return container?.parentComp ?? null;
  }

  addComponent(
    parentPath: string,
    label: string,
    leaf = false,
  ): ComponentData | null {
    const container = this.findContainer(parentPath);
    if (!container) return null;

    const list = container.parentComp
      ? container.parentComp.components
      : container.sys.components;
    const existing = list.find((c) => c.label === label);
    if (existing) return existing;

    const newComp: ComponentData = {
      label,
      description: "",
      icon: "",
      tags: [],
      leaf,
      ports: [],
      components: [],
      connections: [],
    };
    if (container.parentComp?.leaf) {
      container.parentComp.leaf = false;
    }
    list.push(newComp);
    return newComp;
  }

  updateComponent(path: string, patch: Partial<ComponentData>): boolean {
    const comp = this.findComponent(path);
    if (!comp) return false;
    Object.assign(comp, patch);
    return true;
  }

  deleteComponent(path: string): boolean {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    const compLabel = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const container = this.findContainer(parentPath);
    if (!container) return false;

    const list = container.parentComp
      ? container.parentComp.components
      : container.sys.components;
    const idx = list.findIndex((c) => c.label === compLabel);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
    return false;
  }

  reparentComponent(sourcePath: string, targetParentPath: string): boolean {
    const parts = sourcePath.split("/").filter(Boolean);
    if (parts.length < 2) return false;
    const compLabel = parts[parts.length - 1];
    const sourceParentPath = parts.slice(0, -1).join("/");

    // Guard (a): Cannot reparent into same parent or into own subtree / descendant
    if (sourceParentPath === targetParentPath) return false;
    if (
      targetParentPath === sourcePath ||
      targetParentPath.startsWith(`${sourcePath}/`)
    ) {
      return false;
    }

    const srcContainer = this.findContainer(sourceParentPath);
    const targetContainer = this.findContainer(targetParentPath);
    if (!srcContainer || !targetContainer) return false;

    const srcList = srcContainer.parentComp
      ? srcContainer.parentComp.components
      : srcContainer.sys.components;
    const targetList = targetContainer.parentComp
      ? targetContainer.parentComp.components
      : targetContainer.sys.components;

    // Guard (b): Target container must not already have a child with the same label
    if (targetList.some((c) => c.label === compLabel)) {
      return false;
    }

    const idx = srcList.findIndex((c) => c.label === compLabel);
    if (idx === -1) return false;

    const [removed] = srcList.splice(idx, 1);
    if (removed === undefined) return false;
    if (targetContainer.parentComp?.leaf) {
      targetContainer.parentComp.leaf = false;
    }
    targetList.push(removed);
    return true;
  }

  addPort(
    compPath: string,
    label: string,
    protocol = "",
    role: "provider" | "consumer" | "peer" = "peer",
    external = false,
    required = true,
  ): PortData | null {
    const comp = this.findComponent(compPath);
    if (!comp) return null;
    const existing = comp.ports.find((p) => p.label === label);
    if (existing) return existing;

    const newPort: PortData = {
      label,
      description: "",
      protocol,
      role,
      external,
      required,
      tags: [],
    };
    comp.ports.push(newPort);
    return newPort;
  }

  addProtocol(
    label: string,
    description = "",
    roles: ("provider" | "consumer" | "peer")[] = [
      "provider",
      "consumer",
      "peer",
    ],
  ): ProtocolData {
    const existing = this.protocols.find((p) => p.label === label);
    if (existing) return existing;
    const proto: ProtocolData = {
      label,
      description,
      tags: [],
      roles,
      messages: [],
    };
    this.protocols.push(proto);
    return proto;
  }

  getProtocol(label: string): ProtocolData | undefined {
    return this.protocols.find((p) => p.label === label);
  }

  deleteProtocol(label: string): boolean {
    const idx = this.protocols.findIndex((p) => p.label === label);
    if (idx !== -1) {
      this.protocols.splice(idx, 1);
      return true;
    }
    return false;
  }

  updatePort(
    compPath: string,
    portLabel: string,
    patch: Partial<PortData>,
  ): boolean {
    const comp = this.findComponent(compPath);
    if (!comp) return false;
    const port = comp.ports.find((p) => p.label === portLabel);
    if (!port) return false;
    Object.assign(port, patch);
    return true;
  }

  deletePort(compPath: string, portLabel: string): boolean {
    const comp = this.findComponent(compPath);
    if (!comp) return false;
    const idx = comp.ports.findIndex((p) => p.label === portLabel);
    if (idx !== -1) {
      comp.ports.splice(idx, 1);
      return true;
    }
    return false;
  }

  addConnection(
    parentScopePath: string,
    conn: {
      label: string;
      from: string;
      to: string;
      description?: string;
      tags?: string[];
    },
  ): ConnectionData | null {
    const container = this.findContainer(parentScopePath);
    if (!container) return null;

    const list = container.parentComp
      ? container.parentComp.connections
      : container.sys.connections;
    const existing = list.find((c) => c.label === conn.label);
    if (existing) return existing;

    const newConn: ConnectionData = {
      label: conn.label,
      from: conn.from,
      to: conn.to,
      description: conn.description ?? "",
      tags: conn.tags ?? [],
      encapsulates: [],
    };
    list.push(newConn);
    return newConn;
  }

  deleteConnection(parentScopePath: string, label: string): boolean {
    const container = this.findContainer(parentScopePath);
    if (!container) return false;
    const list = container.parentComp
      ? container.parentComp.connections
      : container.sys.connections;
    const idx = list.findIndex((c) => c.label === label);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
    return false;
  }

  // ── Views & Layout Mutations ────────────────────────────────────────────────

  getView(label: string): ViewDefinition | undefined {
    return this.views.find((v) => v.label === label);
  }

  addView(label: string, system: string, description = ""): ViewDefinition {
    const existing = this.getView(label);
    if (existing) return existing;
    const v: ViewDefinition = {
      label,
      description,
      tags: [],
      system,
      filter: { include_tags: [], exclude_tags: [], components: [] },
      nodes: [],
    };
    this.views.push(v);
    return v;
  }

  updateNodeLayout(
    viewLabel: string,
    componentKey: string,
    layout: {
      x: number;
      y: number;
      width?: number;
      height?: number;
      text_align?: string;
    },
  ): void {
    let view = this.getView(viewLabel);
    if (!view) {
      const defaultSys = this.systems[0]?.label ?? "default";
      view = this.addView(viewLabel, defaultSys);
    }
    view.nodes ??= [];
    const existingNode = view.nodes.find((n) => n.component === componentKey);
    if (existingNode) {
      existingNode.x = layout.x;
      existingNode.y = layout.y;
      if (layout.width !== undefined) existingNode.width = layout.width;
      if (layout.height !== undefined) existingNode.height = layout.height;
      if (layout.text_align !== undefined) {
        existingNode.text_align = layout.text_align;
      }
    } else {
      const node: NodeLayout = {
        component: componentKey,
        x: layout.x,
        y: layout.y,
      };
      if (layout.width !== undefined) node.width = layout.width;
      if (layout.height !== undefined) node.height = layout.height;
      if (layout.text_align !== undefined) node.text_align = layout.text_align;
      view.nodes.push(node);
    }
  }

  // ── Load / Ingestion from HCL / Model ────────────────────────────────────────

  loadFromRawModel(raw: RawModelPayload, viewsHcl?: string): void {
    this.project = {
      name: raw.project?.name ?? "untitled",
      version: raw.project?.version ?? "0.1.0",
      authors: raw.project?.authors ?? [],
    };

    const comps = raw.components ?? [];
    const protos = raw.protocols ?? [];
    const ports = raw.ports ?? [];
    const conns = raw.connections ?? [];
    const msgs = raw.messages ?? [];
    const flds = raw.fields ?? [];

    this.protocols = protos.map((proto: {
      label: string;
      description?: string;
      tags?: string[];
      roles?: string[];
      messages?: number[];
    }): ProtocolData => ({
      label: proto.label,
      description: proto.description ?? "",
      tags: proto.tags ?? [],
      roles: (proto.roles ?? []).map((r: string) =>
        r.toLowerCase() as "provider" | "consumer" | "peer"
      ),
      messages: (proto.messages ?? []).map((mid: number): MessageData => {
        const m = arenaAt(msgs, mid);
        return {
          label: m.label,
          description: m.description ?? "",
          tags: m.tags ?? [],
          level: m.level,
          fields: (m.fields ?? []).map((fid: number): FieldData => {
            const f = arenaAt(flds, fid);
            return {
              label: f.label,
              type: f.field_type ?? "string",
              description: f.description ?? "",
              unit: f.unit ?? "",
              required: f.required,
            };
          }),
        };
      }),
    }));

    const buildComp = (cid: number): ComponentData => {
      const c = arenaAt(comps, cid);
      return {
        label: c.label,
        source: c.source ?? undefined,
        description: c.description ?? "",
        icon: c.icon ?? "",
        color: c.color ?? "",
        border: (c.border as "solid" | "dashed" | "dotted" | undefined) ??
          undefined,
        font: c.font ?? "",
        tags: c.tags ?? [],
        level: c.level,
        leaf: c.leaf ?? false,
        ports: (c.ports ?? []).map((pid: number): PortData => {
          const p = arenaAt(ports, pid);
          return {
            label: p.label,
            description: p.description ?? "",
            protocol: p.protocol ?? "",
            role: (p.role ? p.role.toLowerCase() : "peer") as
              | "provider"
              | "consumer"
              | "peer",
            external: p.external,
            required: p.required ?? true,
            tags: p.tags ?? [],
          };
        }),
        components: (c.children ?? []).map((childId: number) =>
          buildComp(childId)
        ),
        connections: (c.connections ?? []).map((connId: number) =>
          buildConn(connId)
        ),
      };
    };

    const buildConn = (connId: number): ConnectionData => {
      const cn = arenaAt(conns, connId);
      const fromComp = arenaAt(comps, cn.from.component).label;
      const fromStr = cn.from.port !== null && cn.from.port !== undefined
        ? `${fromComp}/${arenaAt(ports, cn.from.port).label}`
        : fromComp;
      const toComp = arenaAt(comps, cn.to.component).label;
      const toStr = cn.to.port !== null && cn.to.port !== undefined
        ? `${toComp}/${arenaAt(ports, cn.to.port).label}`
        : toComp;

      return {
        label: cn.label,
        description: cn.description ?? "",
        tags: cn.tags ?? [],
        level: cn.level,
        from: fromStr,
        to: toStr,
        encapsulates: (cn.encapsulates ?? []).map((id: number) =>
          arenaAt(conns, id).label
        ),
      };
    };

    this.systems = (raw.systems ?? []).map((
      sys: {
        label: string;
        description?: string;
        tags?: string[];
        level?: number;
        components?: number[];
        connections?: number[];
      },
    ) => ({
      label: sys.label,
      description: sys.description ?? "",
      tags: sys.tags ?? [],
      level: sys.level ?? 0,
      components: (sys.components ?? []).map((cid: number) => buildComp(cid)),
      connections: (sys.connections ?? []).map((connId: number) =>
        buildConn(connId)
      ),
    }));

    if (viewsHcl) {
      try {
        this.views = parse_views(viewsHcl);
      } catch (err) {
        console.warn("Failed to parse views HCL:", err);
      }
    }
  }

  loadFromSources(
    sources: { filename: string; content: string }[],
    viewsHcl?: string,
  ): void {
    const res = compile_system(sources);
    const model = res.model();
    if (!model) {
      console.warn(
        "Compilation had errors during loadFromSources, loading partial state",
      );
      return;
    }
    this.loadFromRawModel(model.to_js() as RawModelPayload, viewsHcl);
  }

  loadFromHcl(systemHcl: string, viewsHcl?: string): void {
    this.loadFromSources(
      [{ filename: "system.hcl", content: systemHcl }],
      viewsHcl,
    );
  }
}
