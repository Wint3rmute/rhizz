// Centralized reactive document store for a Rhizz project.
// Holds mutable in-memory system architecture models and visual view layouts,
// automatically deriving canonical HCL representations, diagnostics, and scores.

import {
  compile_system,
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
  required?: boolean;
}

export interface MessageData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number;
  fields: FieldData[];
}

export interface PortData {
  label: string;
  description?: string;
  protocol?: string;
  role: "provider" | "consumer" | "peer";
  tags?: string[];
  messages: MessageData[];
}

export interface ConnectionData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number;
  from: string;
  to: string;
  encapsulates?: string[];
}

export interface ComponentData {
  label: string;
  description?: string;
  tags?: string[];
  level?: number;
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

function formatStringList(items?: string[]): string {
  if (!items || items.length === 0) return "[]";
  return `[${items.map((it) => escapeHclString(it)).join(", ")}]`;
}

export class DocumentStore {
  project = $state<ProjectMetadata>({
    name: "untitled",
    version: "0.1.0",
    authors: [],
  });

  systems = $state<SystemData[]>([]);
  views = $state<ViewDefinition[]>([]);

  // ── Derived HCL text ─────────────────────────────────────────────────────────

  systemHcl = $derived.by(() => {
    const lines: string[] = [];

    // Project block
    if (
      this.project.name || this.project.version ||
      (this.project.authors && this.project.authors.length > 0)
    ) {
      lines.push("project {");
      if (this.project.name) {
        lines.push(`  name    = ${escapeHclString(this.project.name)}`);
      }
      if (this.project.version && this.project.version !== "0.0.0") {
        lines.push(`  version = ${escapeHclString(this.project.version)}`);
      }
      if (this.project.authors && this.project.authors.length > 0) {
        lines.push(`  authors = ${formatStringList(this.project.authors)}`);
      }
      lines.push("}\n");
    }

    // System blocks
    const sortedSystems = [...this.systems].sort((a, b) =>
      a.label.localeCompare(b.label)
    );

    for (let i = 0; i < sortedSystems.length; i++) {
      const sys = sortedSystems[i];
      lines.push(`system ${escapeHclString(sys.label)} {`);
      if (sys.description) {
        lines.push(`  description = ${escapeHclString(sys.description)}`);
      }
      if (sys.tags && sys.tags.length > 0) {
        lines.push(`  tags        = ${formatStringList(sys.tags)}`);
      }
      if (sys.level !== undefined && sys.level !== 0) {
        lines.push(`  level       = ${sys.level}`);
      }

      // Child components
      const sortedComps = [...sys.components].sort((a, b) =>
        a.label.localeCompare(b.label)
      );
      for (const comp of sortedComps) {
        lines.push("");
        this.serializeComponent(lines, comp, 1, sys.level ?? 0);
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
      if (i + 1 < sortedSystems.length) lines.push("");
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

  private serializeComponent(
    lines: string[],
    comp: ComponentData,
    depth: number,
    parentLevel: number,
  ) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}component ${escapeHclString(comp.label)} {`);
    const inner = "  ".repeat(depth + 1);

    if (comp.description) {
      lines.push(`${inner}description = ${escapeHclString(comp.description)}`);
    }
    if (comp.tags && comp.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(comp.tags)}`);
    }
    if (comp.level !== undefined && comp.level !== parentLevel + 1) {
      lines.push(`${inner}level       = ${comp.level}`);
    }
    if (comp.leaf) lines.push(`${inner}leaf        = true`);

    const curLevel = comp.level ?? parentLevel + 1;

    // Ports
    const sortedPorts = [...comp.ports].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const port of sortedPorts) {
      lines.push("");
      this.serializePort(lines, port, depth + 1, curLevel);
    }

    // Sub-components
    const sortedChildren = [...comp.components].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const child of sortedChildren) {
      lines.push("");
      this.serializeComponent(lines, child, depth + 1, curLevel);
    }

    // Sub-connections
    const sortedConns = [...comp.connections].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const conn of sortedConns) {
      lines.push("");
      this.serializeConnection(lines, conn, depth + 1, curLevel);
    }

    lines.push(`${indent}}`);
  }

  private serializePort(
    lines: string[],
    port: PortData,
    depth: number,
    parentLevel: number,
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
    lines.push(`${inner}role        = ${escapeHclString(port.role || "peer")}`);
    if (port.tags && port.tags.length > 0) {
      lines.push(`${inner}tags        = ${formatStringList(port.tags)}`);
    }

    const sortedMsgs = [...port.messages].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    for (const msg of sortedMsgs) {
      lines.push("");
      this.serializeMessage(lines, msg, depth + 1, parentLevel);
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
      lines.push(`${inner}level       = ${msg.level}`);
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
      lines.push(`${inner}level        = ${conn.level}`);
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
  private findContainer(
    path: string,
  ): { sys: SystemData; parentComp?: ComponentData } | null {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const sys = this.getSystem(parts[0]);
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
      tags: [],
      leaf,
      ports: [],
      components: [],
      connections: [],
    };
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
      tags: [],
      messages: [],
    };
    comp.ports.push(newPort);
    return newPort;
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
      description: conn.description || "",
      tags: conn.tags || [],
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
      output: { filename: `${label}.dot`, rankdir: "TB" },
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
      const defaultSys = this.systems[0]?.label || "default";
      view = this.addView(viewLabel, defaultSys);
    }
    if (!view.nodes) view.nodes = [];
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
      view.nodes.push({
        component: componentKey,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        text_align: layout.text_align,
      });
    }
  }

  // ── Load / Ingestion from HCL ───────────────────────────────────────────────

  loadFromHcl(systemHcl: string, viewsHcl?: string): void {
    const res = compile_system([{
      filename: "system.hcl",
      content: systemHcl,
    }]);
    const model = res.model();
    if (!model) {
      console.warn(
        "Compilation had errors during loadFromHcl, loading partial state",
      );
      return;
    }

    const raw = model.to_js();
    this.project = {
      name: raw.project.name || "untitled",
      version: raw.project.version || "0.1.0",
      authors: raw.project.authors || [],
    };

    const comps = raw.components;
    const ports = raw.ports;
    const conns = raw.connections;
    const msgs = raw.messages;
    const flds = raw.fields;

    const buildComp = (cid: number): ComponentData => {
      const c = comps[cid];
      return {
        label: c.label,
        description: c.description || "",
        tags: c.tags || [],
        level: c.level,
        leaf: Boolean(c.leaf),
        ports: (c.ports || []).map((pid: number): PortData => {
          const p = ports[pid];
          return {
            label: p.label,
            description: p.description || "",
            protocol: p.protocol || "",
            role: (p.role ? String(p.role).toLowerCase() : "peer") as
              | "provider"
              | "consumer"
              | "peer",
            tags: p.tags || [],
            messages: (p.messages || []).map((mid: number): MessageData => {
              const m = msgs[mid];
              return {
                label: m.label,
                description: m.description || "",
                tags: m.tags || [],
                level: m.level,
                fields: (m.fields || []).map((fid: number): FieldData => {
                  const f = flds[fid];
                  return {
                    label: f.label,
                    type: f.field_type || "string",
                    description: f.description || "",
                    unit: f.unit || "",
                    required: Boolean(f.required),
                  };
                }),
              };
            }),
          };
        }),
        components: (c.children || []).map((childId: number) =>
          buildComp(childId)
        ),
        connections: (c.connections || []).map((connId: number) =>
          buildConn(connId)
        ),
      };
    };

    const buildConn = (connId: number): ConnectionData => {
      const cn = conns[connId];
      const fromComp = comps[cn.from.component].label;
      const fromStr = cn.from.port !== null && cn.from.port !== undefined
        ? `${fromComp}:${ports[cn.from.port].label}`
        : fromComp;
      const toComp = comps[cn.to.component].label;
      const toStr = cn.to.port !== null && cn.to.port !== undefined
        ? `${toComp}:${ports[cn.to.port].label}`
        : toComp;

      return {
        label: cn.label,
        description: cn.description || "",
        tags: cn.tags || [],
        level: cn.level,
        from: fromStr,
        to: toStr,
        encapsulates: (cn.encapsulates || []).map((id: number) =>
          conns[id].label
        ),
      };
    };

    this.systems = (raw.systems || []).map((
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
      description: sys.description || "",
      tags: sys.tags || [],
      level: sys.level || 0,
      components: (sys.components || []).map((cid: number) => buildComp(cid)),
      connections: (sys.connections || []).map((connId: number) =>
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
}
