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

/** Drawn means resolved (not omitted) and not hidden — mirrors `isConnectionDrawn`. */
export function isProjectionDrawn(
  projection: Pick<ConnectionProjection, "kind" | "hidden">,
): boolean {
  return projection.kind !== "omitted" && !projection.hidden;
}
