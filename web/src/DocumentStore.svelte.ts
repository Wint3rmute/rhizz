// Centralized reactive document store for a Rhizz project.
// A reactive *read* model over the compiled Rust model plus the visual view
// layouts. Model writes never go through here: `applyModelMutation`
// (`web/src/history/applyMutation.ts`) executes ops in `rhizz-core` via WASM
// and persists canonical HCL directly. View/layout edits still mutate this
// store (diagrams files are a separate domain).

import { SvelteMap, SvelteSet } from "svelte/reactivity";
import {
  compile_system,
  type NodeLayout,
  parse_views,
  serialize_views,
  type ViewDefinition,
} from "./rhizz_wasm_wrapper";
import type { ComponentPatch, ModelAction } from "./actionLog";

// ── Opt-in mutation observer ────────────────────────────────────────────────
//
// The UI edits the model through short-lived `new DocumentStore()` instances
// (each handler loads the primary HCL, mutates, writes back, then discards
// the instance), so mutations are recorded through a *module-level* observer
// that every instance fires on, rather than per-instance state. This lets the
// diagrams page aggregate a whole session's mutations across all its temporary
// instances without touching the (already large) page.
//
// It is opt-in: the observer set is empty by default, so the simulation harness
// and the unit tests — which create and mutate their own stores to verify
// invariants — never emit anything unless a caller subscribes. The diagrams
// page subscribes once at module scope (per page load) to aggregate a session's
// mutations.

type MutationObserver = (action: ModelAction) => void;

const mutationObservers = new SvelteSet<MutationObserver>();

/** Subscribes a callback to every successful model mutation across all
 * `DocumentStore` instances. Returns an unsubscribe function. */
export function subscribeToMutations(
  observer: MutationObserver,
): () => void {
  mutationObservers.add(observer);
  return () => {
    mutationObservers.delete(observer);
  };
}

function notifyMutations(action: ModelAction): void {
  for (const observer of mutationObservers) observer(action);
}

/** Forwards a Rust-reported model action to the mutation observers.
 * `applyModelMutation` executes ops in `rhizz-core`, so the store methods
 * that used to notify never run on the write path — the dispatcher calls
 * this with each action Rust reports instead. */
export function recordModelAction(action: ModelAction): void {
  notifyMutations(action);
}

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
  /** The label of the top-level reusable definition this component is an
   * *instance* of (`instance "<local>" { source = "<definition>" }`), if any.
   * `undefined` when the component is a definition or carries its body inline
   * (the old `source`-carrying inline bodies are gone). */
  source?: string | undefined;
  /** Whether this is a top-level reusable definition (lives in `definitions`,
   * has no parent) as opposed to a placed instance. */
  isDefinition?: boolean | undefined;
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
  /** Placed `instance` children (source-bearing references to definitions). */
  components: ComponentData[];
  connections: ConnectionData[];
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
    kind?: string;
    // Parent is serialized as e.g. `{"Component": 0}` or `{"System": 0}`.
    parent?: { Component?: number; System?: number };
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
  /** Arena indices into `components` of the top-level reusable definitions. */
  definitions?: number[];
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
  /** Top-level reusable component definitions (no parent). */
  definitions = $state<ComponentData[]>([]);
  views = $state<ViewDefinition[]>([]);

  // ── Derived HCL text ─────────────────────────────────────────────────────────

  viewsHcl = $derived.by(() => {
    return serialize_views(this.views);
  });

  getSystem(label: string): SystemData | undefined {
    return this.systems.find((s) => s.label === label);
  }

  // Finds a component container by path. A path like "quad" resolves to a
  // SystemData; "quad/fc" to the ComponentData `fc` inside that system, and
  // a bare definition label ("engine") resolves to that top-level reusable
  // definition's body.
  findContainer(
    path: string,
  ): {
    sys?: SystemData;
    def?: ComponentData;
    parentComp?: ComponentData;
  } | null {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const firstPart = parts[0];
    if (firstPart === undefined) return null;

    // A bare label that matches a top-level reusable definition resolves to
    // that definition's body.
    const def = parts.length === 1
      ? this.definitions.find((c) => c.label === firstPart)
      : undefined;
    if (def && parts.length === 1) return { def };

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
    if (container?.parentComp) return container.parentComp;
    if (container?.def) return container.def;
    return null;
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
      annotations: [],
    };
    this.views.push(v);
    notifyMutations({ op: "add_view", label, system });
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
    notifyMutations({
      op: "update_node_layout",
      viewLabel,
      componentKey,
      layout: {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        text_align: layout.text_align,
      },
    });
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
        isDefinition: c.kind === "Definition",
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
          buildConn(connId, compPath(cid))
        ),
      };
    };

    // Build a parent index (component index -> parent component index) and a
    // root-system label per component, so connection endpoints can be emitted
    // as full paths (scope-independent) rather than bare labels.
    const parentOfComp = new SvelteMap<number, number>();
    const rootSystemOfComp = new SvelteMap<number, string>();
    for (const sys of raw.systems ?? []) {
      const walk = (cid: number, parent: number | null, root: string) => {
        if (parent === null) {
          rootSystemOfComp.set(cid, root);
        } else {
          parentOfComp.set(cid, parent);
          rootSystemOfComp.set(cid, root);
        }
        const c = arenaAt(comps, cid);
        for (const child of c.children ?? []) walk(child, cid, root);
      };
      for (const cid of sys.components ?? []) walk(cid, null, sys.label);
    }
    const compPath = (cid: number): string => {
      const segs: string[] = [];
      let cur: number | undefined = cid;
      while (cur !== undefined) {
        segs.unshift(arenaAt(comps, cur).label);
        cur = parentOfComp.get(cur);
      }
      const root = rootSystemOfComp.get(cid);
      if (root) segs.unshift(root);
      return segs.join("/");
    };

    // Builds the endpoint path relative to the connection's declaring scope
    // (the scope path passed in), so it resolves on re-parse regardless of
    // where the connection is placed.
    const buildConn = (connId: number, scopePath: string): ConnectionData => {
      const cn = arenaAt(conns, connId);
      const rel = (cid: number): string => {
        const full = compPath(cid);
        if (scopePath && full.startsWith(scopePath + "/")) {
          return full.slice(scopePath.length + 1);
        }
        return full;
      };
      const fromPath = rel(cn.from.component);
      const fromStr = cn.from.port !== null && cn.from.port !== undefined
        ? `${fromPath}/${arenaAt(ports, cn.from.port).label}`
        : fromPath;
      const toPath = rel(cn.to.component);
      const toStr = cn.to.port !== null && cn.to.port !== undefined
        ? `${toPath}/${arenaAt(ports, cn.to.port).label}`
        : toPath;

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

    this.definitions = (raw.definitions ?? []).map((cid: number) =>
      buildComp(cid)
    );

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
      components: (sys.components ?? []).map((cid: number) => buildComp(cid)),
      connections: (sys.connections ?? []).map((connId: number) =>
        buildConn(connId, sys.label)
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
