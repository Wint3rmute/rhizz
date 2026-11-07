// Pure projection resolver for SPEC.md §6.3–§6.4 + §6.7 item 2: no UI, no
// store access, so the modeling inspector (sidebar) and the canvas edge list
// share one rule and cannot disagree (same pattern as connectionVisibility).
//
// Visibility means placed as a `node` in the same view and system, hence the
// `placed` + `inSystem` pair (mirroring `isPlacedInSystem`). Hidden stays a
// separate caller-side filter — as in `isConnectionDrawn` — so the sidebar can
// keep hidden connections listed but unchecked (0005.1).

export type ProjectionKind = "direct" | "projected" | "omitted";

export interface ProjectionEndpointRef {
  label: string;
  from: number;
  to: number;
  fromPort?: string | undefined;
  toPort?: string | undefined;
}

export interface ProjectionContext {
  placed: ReadonlySet<number>;
  inSystem: (index: number) => boolean;
  /** Parent arena index; `undefined` for roots and system children. */
  parentOf: (index: number) => number | undefined;
  /** Component label for relative-path segments (real labels never contain `/`). */
  labelOf: (index: number) => string;
  /** Per-view hidden flag keyed by connection name; defaults to not hidden. */
  isHidden?: (label: string) => boolean;
}

export interface ConnectionProjection {
  kind: ProjectionKind;
  /** Visible ancestor rendering `from` (the owner itself when direct). */
  from: number;
  /** Visible ancestor rendering `to` (the owner itself when direct). */
  to: number;
  /** Original port when direct, `<rel-path>/<port>` when projected. */
  fromPort?: string | undefined;
  /** Original port when direct, `<rel-path>/<port>` when projected. */
  toPort?: string | undefined;
  hidden: boolean;
}

interface VisibleAncestor {
  ancestor: number;
  /** Labels from the ancestor's child down to the owner (empty = direct). */
  relLabels: string[];
}

/** Walk owner → parents (inclusive) to the first placed, in-system component. */
export function nearestVisibleAncestor(
  owner: number,
  context: Pick<
    ProjectionContext,
    "placed" | "inSystem" | "parentOf" | "labelOf"
  >,
): VisibleAncestor | undefined {
  const relLabels: string[] = [];
  const visited = new Set<number>();
  let current = owner;
  for (;;) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    if (context.placed.has(current) && context.inSystem(current)) {
      return { ancestor: current, relLabels: relLabels.reverse() };
    }
    const parent = context.parentOf(current);
    if (parent === undefined) return undefined;
    relLabels.push(context.labelOf(current));
    current = parent;
  }
}

/** Derive the port name shown on the ancestor (`SPEC.md` §6.4). */
export function projectedPortName(
  relLabels: readonly string[],
  port: string | undefined,
): string | undefined {
  if (relLabels.length === 0) return port;
  if (port === undefined) return undefined;
  return `${relLabels.join("/")}/${port}`;
}

export function resolveConnectionProjection(
  conn: ProjectionEndpointRef,
  context: ProjectionContext,
): ConnectionProjection {
  const hidden = context.isHidden?.(conn.label) ?? false;
  const fromVisible = nearestVisibleAncestor(conn.from, context);
  const toVisible = nearestVisibleAncestor(conn.to, context);
  if (fromVisible === undefined || toVisible === undefined) {
    return {
      kind: "omitted",
      from: conn.from,
      to: conn.to,
      fromPort: conn.fromPort,
      toPort: conn.toPort,
      hidden,
    };
  }
  const fromProjected = fromVisible.relLabels.length > 0;
  const toProjected = toVisible.relLabels.length > 0;
  if (!fromProjected && !toProjected) {
    return {
      kind: "direct",
      from: conn.from,
      to: conn.to,
      fromPort: conn.fromPort,
      toPort: conn.toPort,
      hidden,
    };
  }
  if (fromVisible.ancestor === toVisible.ancestor) {
    // Projected self-edge (SPEC.md §6.7 item 2): omitted. Genuine system
    // self-connections (both ends directly placed) take the branch above.
    return {
      kind: "omitted",
      from: fromVisible.ancestor,
      to: toVisible.ancestor,
      fromPort: projectedPortName(fromVisible.relLabels, conn.fromPort),
      toPort: projectedPortName(toVisible.relLabels, conn.toPort),
      hidden,
    };
  }
  return {
    kind: "projected",
    from: fromVisible.ancestor,
    to: toVisible.ancestor,
    fromPort: projectedPortName(fromVisible.relLabels, conn.fromPort),
    toPort: projectedPortName(toVisible.relLabels, conn.toPort),
    hidden,
  };
}

/** Batch variant: every copy resolves independently under its own owner path. */
export function resolveConnectionProjections<T extends ProjectionEndpointRef>(
  conns: readonly T[],
  context: ProjectionContext,
): (T & ConnectionProjection)[] {
  return conns.map((conn) => ({
    ...conn,
    ...resolveConnectionProjection(conn, context),
  }));
}

/**
 * ConnectionJS (wasm) exposes ports as `from_port`/`to_port` getters while the
 * resolver speaks camelCase. Read both so a spread (which drops prototype
 * getters) can never silently lose the anchoring ports.
 */
export function normalizeEndpointRef(
  conn: ProjectionEndpointRef & {
    from_port?: string | null | undefined;
    to_port?: string | null | undefined;
  },
): ProjectionEndpointRef {
  return {
    label: conn.label,
    from: conn.from,
    to: conn.to,
    fromPort: conn.fromPort ?? conn.from_port ?? undefined,
    toPort: conn.toPort ?? conn.to_port ?? undefined,
  };
}

/** Drawn means resolved (not omitted) and not hidden — mirrors `isConnectionDrawn`. */
export function isProjectionDrawn(
  projection: Pick<ConnectionProjection, "kind" | "hidden">,
): boolean {
  return projection.kind !== "omitted" && !projection.hidden;
}

export interface SidebarProjectionRow {
  label: string;
  /** Checked: at least one copy is drawn on the canvas. */
  shown: boolean;
  /** At least one copy resolves `projected` under current visibility. */
  projected: boolean;
}

/**
 * Sidebar rows, grouped by connection name: every in-system connection is
 * listed (placed or not), checked when drawn on the canvas, badged when
 * projected. `shown` follows the projection-aware drawn rule
 * (`isProjectionDrawn`), so sidebar and canvas agree; `projected` is the
 * visibility-only signal for the badge.
 */
export function sidebarProjectionRows(
  conns: readonly ProjectionEndpointRef[],
  context: ProjectionContext,
): SidebarProjectionRow[] {
  const byLabel = new Map<
    string,
    { listed: boolean; shown: boolean; projected: boolean }
  >();
  for (const conn of conns) {
    let entry = byLabel.get(conn.label);
    if (!entry) {
      entry = { listed: false, shown: false, projected: false };
      byLabel.set(conn.label, entry);
    }
    if (!context.inSystem(conn.from) || !context.inSystem(conn.to)) continue;
    entry.listed = true;
    const resolution = resolveConnectionProjection(conn, context);
    if (isProjectionDrawn(resolution)) {
      entry.shown = true;
    }
    if (resolution.kind === "projected") {
      entry.projected = true;
    }
  }
  return [...byLabel.entries()]
    .filter(([, entry]) => entry.listed)
    .map(([label, entry]) => ({
      label,
      shown: entry.shown,
      projected: entry.projected,
    }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

export interface ProjectedPortDot {
  ancestor: number;
  /** View-local name (`<rel-path>/<port>`); never collides — see §3. */
  label: string;
  role: "provider" | "consumer" | "peer";
  protocol?: string | undefined;
}

/** Normalizes a stored role exactly like `modelView.toRole`: only provider /
 * consumer survive, everything else (including absent) is a peer. */
function toDotRole(role: string | undefined): ProjectedPortDot["role"] {
  const normalized = role?.toLowerCase();
  return normalized === "provider" || normalized === "consumer"
    ? normalized
    : "peer";
}

/**
 * One draggable dot per projected endpoint of every connection: the visible
 * ancestor plus the derived port name. Role/protocol inherit from the
 * original descendant port (found via ancestor key + relative path); a port
 * whose hierarchy entry is gone falls back to peer/untyped and still renders
 * — stale *customizations* are ignored later (0005.4), the dot itself follows
 * the live edge. Direct endpoints and bare (portless) ends yield no dot.
 * Deduped by ancestor + label so fan-out edges share one dot.
 */
export function projectedPortDots(
  conns: readonly ProjectionEndpointRef[],
  context: ProjectionContext,
  ancestorKeyOf: (index: number) => string,
  portsOf: (
    componentKey: string,
  ) => { label: string; role?: string; protocol?: string }[] | undefined,
): ProjectedPortDot[] {
  const seen = new Set<string>();
  const dots: ProjectedPortDot[] = [];
  const emit = (owner: number, port: string | undefined): void => {
    if (port === undefined) return;
    const visible = nearestVisibleAncestor(owner, context);
    if (visible === undefined || visible.relLabels.length === 0) return;
    const label = projectedPortName(visible.relLabels, port);
    if (label === undefined) return;
    const key = `${String(visible.ancestor)}:${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    const ownerKey = `${ancestorKeyOf(visible.ancestor)}/${visible.relLabels.join("/")}`;
    const original = portsOf(ownerKey)?.find((p) => p.label === port);
    dots.push({
      ancestor: visible.ancestor,
      label,
      role: toDotRole(original?.role),
      ...(original?.protocol ? { protocol: original.protocol } : {}),
    });
  };
  for (const conn of conns) {
    emit(conn.from, conn.fromPort);
    emit(conn.to, conn.toPort);
  }
  return dots.sort((a, b) =>
    a.ancestor !== b.ancestor
      ? a.ancestor - b.ancestor
      : a.label < b.label
        ? -1
        : a.label > b.label
          ? 1
          : 0,
  );
}
