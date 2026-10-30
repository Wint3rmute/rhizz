// Read-only, flat projections of the compiled model for the UI.
//
// Everything the frontend renders about a component — its inspector fields,
// its icon/color/border/font, its ports — is reachable from the compiled
// model plus rhizz-core's canonical `component_keys()`. There is no second
// TypeScript model tree to keep in sync: model *writes* go through
// `applyModelMutation` (`history/applyMutation.ts`), which executes the op in
// Rust and persists canonical HCL. This module only reads.
//
// Deliberately has zero dependency on Svelte, so it is unit-testable in plain
// Node (see modelView.test.ts).
import type { ModelJS } from "rhizz";
import type { ConnectionRef } from "./actionLog";
import { componentKeyAt } from "./modelKeys";
import type { PortSpot } from "./routes/projects/[id]/modeling/geometry";
import type { DiagramStaticPort } from "./routes/projects/[id]/modeling/types";
import type { BorderStyle } from "./routes/projects/[id]/modeling/visuals";
import {
  type ComponentColor,
  type ComponentFont,
  DEFAULT_COLOR,
  DEFAULT_FONT,
  toBorderStyle,
} from "./routes/projects/[id]/modeling/visuals";

export interface PortData {
  label: string;
  full_name?: string;
  protocol?: string;
  role: "provider" | "consumer" | "peer";
  external?: boolean | undefined;
  required?: boolean | undefined;
  tags?: string[];
}

/** The component fields the inspector reads and the `update_component` op patches.
 *
 * Visual attributes are total — never `undefined`: the projection below
 * normalizes absent/empty values to their explicit defaults (`"default"`,
 * `"solid"`, `"unstyled"`), so readers never branch on absence and patches
 * spell a clear with the same vocabulary. Colors and fonts stay open
 * (hex/CSS passthrough is real), borders are a closed enum.
 */
export interface ComponentData {
  label: string;
  /**
   * The top-level definition this component was instantiated from (`source` in
   * the HCL), when it is an instance. Absent on definitions and on components
   * that carry their body inline.
   *
   * Read-only: `source` is what makes an instance a placement of a shared
   * definition, so changing it is a re-source, not an attribute edit. The
   * mutable subset is `ComponentPatch` (see `actionLog.ts`), which excludes it.
   */
  source?: string | undefined;
  full_name?: string;
  icon?: string | undefined;
  color: ComponentColor;
  border: BorderStyle;
  font: ComponentFont;
  tags?: string[];
  leaf: boolean;
  ports: PortData[];
}

/**
 * Ports for read-only scenes, keyed by arena index: the model's port data
 * with per-view outline spots applied. Drives labels and edge anchoring in
 * Explore, Inventory, embeds, and the book example — the same placement the
 * editor shows, minus the dots (no interactivity there).
 */
export function staticPortsByIndex(
  model: ModelJS | undefined,
  componentKeys: readonly string[],
  layoutPorts: Record<string, Record<string, PortSpot>> | undefined,
): Map<number, DiagramStaticPort[]> {
  const out = new Map<number, DiagramStaticPort[]>();
  if (model === undefined) return out;
  const byKey = componentDataByKey(model);
  componentKeys.forEach((key, index) => {
    const data = byKey.get(key);
    if (data === undefined || data.ports.length === 0) return;
    const spots = layoutPorts?.[key];
    out.set(
      index,
      data.ports.map((port) => ({
        label: port.label,
        role: port.role,
        ...(port.protocol ? { protocol: port.protocol } : {}),
        ...(spots?.[port.label] !== undefined
          ? { spot: spots[port.label] }
          : {}),
      })),
    );
  });
  return out;
}

/** A top-level reusable definition offered by "Use Existing Component". */
export interface DefinitionOption {
  /** The `source` label an instance will reference (the definition's identity). */
  sourceLabel: string;
  /** Human-readable label for the dropdown. */
  label: string;
  icon?: string | undefined;
}

/**
 * The `model.to_js()` payload shape. Only the parts the UI reads are typed;
 * rhizz-core's serializer is the source of truth for the rest.
 */
export interface RawModelPayload {
  systems?: {
    label: string;
    full_name?: string;
    icon?: string;
    tags?: string[];
  }[];
  components?: {
    label: string;
    /** The top-level definition an `instance` was sourced from, if any. */
    source?: string;
    /** Parent link, serialized as `{"Component": 0}` or `{"System": 0}`. */
    parent?: { Component?: number; System?: number };
    full_name?: string;
    icon?: string;
    color?: string;
    border?: string;
    font?: string;
    tags?: string[];
    level?: number;
    leaf?: boolean;
    /** Arena indices into `ports`. */
    ports?: number[];
    /** Arena indices into `components`. */
    children?: number[];
  }[];
  /** Arena indices into `components` of the top-level reusable definitions. */
  definitions?: number[];
  ports?: {
    label: string;
    full_name?: string;
    protocol?: string;
    role?: string;
    external?: boolean;
    required?: boolean;
    tags?: string[];
  }[];
  connections?: {
    label: string;
    /** Declaration marker: copies of one declaration share it. */
    decl?: string;
    full_name?: string;
    tags?: string[];
    level?: number;
    from: { component: number; port?: number | null };
    to: { component: number; port?: number | null };
    /** Resolved realization targets: arena indices into `connections`. */
    realized_by_ids?: number[];
  }[];
  protocols?: {
    label: string;
    full_name?: string;
    tags?: string[];
    roles?: string[];
    leaf?: boolean;
    /** Declared labels of the protocols this one can carry. */
    encapsulates?: string[];
    /** Arena indices into `messages`. */
    messages?: number[];
  }[];
  /** Message arena, referenced by `protocols[].messages`. */
  messages?: {
    label: string;
    full_name?: string;
    tags?: string[];
    level?: number;
    /** Arena indices into `fields`. */
    fields?: number[];
  }[];
  /** Field arena, referenced by `messages[].fields`. */
  fields?: {
    label: string;
    field_type?: string;
    full_name?: string;
    unit?: string;
    required?: boolean;
  }[];
}

/** One entry of {@link RawModelPayload}'s component arena. */
export type RawComponent = NonNullable<RawModelPayload["components"]>[number];
/** One entry of {@link RawModelPayload}'s port arena. */
export type RawPort = NonNullable<RawModelPayload["ports"]>[number];
/** One entry of {@link RawModelPayload}'s connection arena. */
export type RawConnection = NonNullable<RawModelPayload["connections"]>[number];
/** One entry of {@link RawModelPayload}'s protocol list. */
export type RawProtocol = NonNullable<RawModelPayload["protocols"]>[number];

/**
 * A connection as the inspector reads it, projected from `ConnectionJS`.
 * Fields that the `update_connection` op patches are plain values; the
 * address (`ref`) is what the op and `realized_by` entries are written with.
 */
export interface ConnectionData {
  ref: ConnectionRef;
  full_name: string;
  tags: string[];
  level: number;
  from_port?: string | undefined;
  to_port?: string | undefined;
  /** Label of the protocol the endpoint ports share, if any. */
  protocol?: string | undefined;
  realized_by: ConnectionRef[];
  complete: boolean;
  /** Root cause of an incomplete chain, when there is one. */
  blocking?: ConnectionRef | undefined;
}

function toRole(role: string | undefined): PortData["role"] {
  const normalized = role?.toLowerCase();
  return normalized === "provider" || normalized === "consumer"
    ? normalized
    : "peer";
}

/**
 * Projects the compiled model into a `ComponentData` per canonical component
 * key (`Model::component_keys`, index-aligned with `model.components()`).
 *
 * Flat on purpose: the UI looks components up *by key*, never by walking a
 * tree, so building the nested `systems → components → children` shape would
 * be pure overhead. On a duplicate key (which the resolver forbids) the first
 * component wins, matching a `find`-by-path lookup.
 */
export function componentDataByKey(
  model: ModelJS | undefined,
): Map<string, ComponentData> {
  const result = new Map<string, ComponentData>();
  if (model === undefined) return result;

  const raw = model.to_js() as RawModelPayload;
  const components = raw.components ?? [];
  const ports = raw.ports ?? [];
  const keys = model.component_keys();

  components.forEach((component, index) => {
    const key = componentKeyAt(keys, index);
    if (result.has(key)) return;
    result.set(key, {
      label: component.label,
      // Instances only: `source` is the definition label they were cloned
      // from, which can differ from the usage-site `label` (that difference is
      // the whole point of the definition/instance split).
      source: component.source === "" ? undefined : component.source,
      full_name: component.full_name ?? "",
      icon: component.icon ?? "",
      color:
        component.color === "" || component.color === undefined
          ? DEFAULT_COLOR
          : component.color,
      border: toBorderStyle(component.border),
      font:
        component.font === "" || component.font === undefined
          ? DEFAULT_FONT
          : component.font,
      tags: component.tags ?? [],
      leaf: component.leaf ?? false,
      ports: (component.ports ?? []).map((portIndex) => {
        const port = ports[portIndex];
        return {
          label: port?.label ?? `#${String(portIndex)}`,
          full_name: port?.full_name ?? "",
          protocol: port?.protocol ?? "",
          role: toRole(port?.role),
          external: port?.external,
          required: port?.required ?? true,
          tags: port?.tags ?? [],
        };
      }),
    });
  });

  return result;
}

/**
 * The reusable definitions offered by "Use Existing Component", sorted by
 * label. Derived from the model's top-level `definitions` indices, so a
 * definition is offered even when it currently has zero instances.
 */
export function definitionOptions(
  model: ModelJS | undefined,
): DefinitionOption[] {
  if (model === undefined) return [];
  const raw = model.to_js() as RawModelPayload;
  const components = raw.components ?? [];
  return (raw.definitions ?? [])
    .map((index) => components[index])
    .filter((component) => component !== undefined)
    .map((component) => ({
      sourceLabel: component.label,
      label: component.label,
      // An empty icon string means "no icon", which callers test with
      // `=== undefined`.
      icon: component.icon === "" ? undefined : component.icon,
    }))
    .sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel));
}

/**
 * Every connection in the model as a {@link ConnectionData}, in arena order.
 * Empty for an undefined model.
 */
export function connectionDataList(
  model: ModelJS | undefined,
): ConnectionData[] {
  if (model === undefined) return [];
  return model.connections().map((connection) => {
    const blocking = connection.blocking;
    return {
      ref: { scopePath: connection.scope_path, label: connection.label },
      full_name: connection.full_name,
      tags: connection.tags,
      level: connection.level,
      from_port: connection.from_port,
      to_port: connection.to_port,
      protocol: connection.protocol,
      realized_by: connection.realized_by.map((target) => ({
        scopePath: target.scope_path,
        label: target.label,
      })),
      complete: connection.complete,
      blocking:
        blocking === undefined
          ? undefined
          : { scopePath: blocking.scope_path, label: blocking.label },
    };
  });
}

/**
 * Labels of the ports on the component instance at `componentKey` that at least
 * one connection in the model uses as an endpoint.
 *
 * Per placed instance, not per definition: a connection names an endpoint
 * component by arena index (which resolves to an instance key for a placed
 * component) and a port by arena index. Two instances of one definition can
 * therefore report different connected ports. A connection's own endpoint port
 * is in the set by definition; the set is useful for spotting its other,
 * unconnected ports.
 *
 * Empty for an undefined model or a key that no longer exists in the model.
 */
export function connectedPortLabels(
  model: ModelJS | undefined,
  componentKey: string,
): ReadonlySet<string> {
  const labels = new Set<string>();
  if (model === undefined) return labels;

  const raw = model.to_js() as RawModelPayload;
  const keys = model.component_keys();
  const componentIndex = keys.indexOf(componentKey);
  if (componentIndex === -1) return labels;

  const ports = raw.ports ?? [];
  for (const connection of raw.connections ?? []) {
    for (const endpoint of [connection.from, connection.to]) {
      if (endpoint.component !== componentIndex || endpoint.port == null) {
        continue;
      }
      const label = ports[endpoint.port]?.label;
      if (label !== undefined) labels.add(label);
    }
  }
  return labels;
}

/** Stable map key for a connection address. */
export function connectionRefKey(ref: ConnectionRef): string {
  return JSON.stringify([ref.scopePath, ref.label]);
}

/** The connection at `ref`, or `undefined` when no connection has that address. */
export function connectionByRef(
  connections: readonly ConnectionData[],
  ref: ConnectionRef,
): ConnectionData | undefined {
  const key = connectionRefKey(ref);
  return connections.find(
    (connection) => connectionRefKey(connection.ref) === key,
  );
}

/** How many connections are typed by `protocol` (its derived protocol). */
export function protocolUsageCount(
  connections: readonly ConnectionData[],
  protocol: string,
): number {
  return connections.filter((connection) => connection.protocol === protocol)
    .length;
}

/**
 * A protocol's attributes, projected from {@link RawProtocol} so the UI never
 * reads the raw payload directly.
 */
export interface ProtocolData {
  label: string;
  full_name: string;
  tags: string[];
  roles: string[];
  leaf: boolean;
  /** Declared labels of the protocols this one can carry. */
  encapsulates: string[];
  /** Labels of the messages the protocol declares, in declaration order. */
  messages: string[];
}

/**
 * Why a connection has no derived protocol, for display. `from` / `to` are
 * the endpoint ports' protocol strings, or `undefined` when an endpoint
 * names no port.
 * Returns `undefined` when the endpoints share a defined protocol.
 */
export function protocolUnresolvedReason(
  from: { protocol: string } | undefined,
  to: { protocol: string } | undefined,
  definedProtocols: readonly string[],
): string | undefined {
  if (from === undefined || to === undefined) {
    return "This connection requires a port path on each endpoint (e.g. `comp/port`).";
  }
  if (from.protocol === "" || to.protocol === "") {
    return "A port on this connection has no protocol.";
  }
  if (from.protocol !== to.protocol) {
    return `The ports use different protocols (${from.protocol} and ${to.protocol}).`;
  }
  if (!definedProtocols.includes(from.protocol)) {
    return `Protocol "${from.protocol}" is not defined.`;
  }
  return undefined;
}

/** Every top-level protocol as a {@link ProtocolData}. Empty for an undefined model. */
export function protocolDataList(model: ModelJS | undefined): ProtocolData[] {
  if (model === undefined) return [];
  const raw = model.to_js() as RawModelPayload;
  const messages = raw.messages ?? [];
  return (raw.protocols ?? []).map((protocol) => ({
    label: protocol.label,
    full_name: protocol.full_name ?? "",
    tags: protocol.tags ?? [],
    roles: protocol.roles ?? [],
    leaf: protocol.leaf ?? false,
    encapsulates: protocol.encapsulates ?? [],
    messages: (protocol.messages ?? []).flatMap((index) => {
      const message = messages[index];
      return message === undefined ? [] : [message.label];
    }),
  }));
}

/** A data field of a protocol message, projected for display. */
export interface ProtocolFieldData {
  label: string;
  /** The field's free-form type string, e.g. `"uint8"`. */
  type: string;
  required: boolean;
}

/** A message a protocol declares, with its fields in declaration order. */
export interface ProtocolMessageData {
  label: string;
  fields: ProtocolFieldData[];
}

/**
 * The messages the protocol `label` declares, each with its fields. Empty when
 * the protocol is unknown or the model is undefined.
 */
export function protocolMessages(
  model: ModelJS | undefined,
  label: string,
): ProtocolMessageData[] {
  if (model === undefined) return [];
  const raw = model.to_js() as RawModelPayload;
  const messages = raw.messages ?? [];
  const fields = raw.fields ?? [];
  const protocol = (raw.protocols ?? []).find((p) => p.label === label);
  if (protocol === undefined) return [];
  return (protocol.messages ?? []).flatMap((index) => {
    const message = messages[index];
    if (message === undefined) return [];
    return [
      {
        label: message.label,
        fields: (message.fields ?? []).flatMap((fieldIndex) => {
          const field = fields[fieldIndex];
          if (field === undefined) return [];
          return [
            {
              label: field.label,
              type: field.field_type ?? "",
              required: field.required ?? false,
            },
          ];
        }),
      },
    ];
  });
}

/** A port that names a protocol, with the definition that declares it. */
export interface ProtocolPortUsage {
  /** Diagram key of the declaring definition (its label for top-level ones). */
  componentKey: string;
  componentLabel: string;
  portLabel: string;
}

/**
 * Where one protocol is used: the ports naming it, the protocols listing it in
 * `encapsulates`, and the connections it types. The delete blockers and the
 * Usage tab both read this.
 */
export interface ProtocolUsage {
  ports: ProtocolPortUsage[];
  /** Labels of the protocols that list this one in `encapsulates`. */
  listedBy: string[];
  connections: ConnectionRef[];
}

/**
 * Usage of the protocol `label`, from already-projected data. Instances are
 * skipped for ports: their ports are the definition's, so counting them would
 * report one port several times.
 */
export function protocolUsage(
  label: string,
  components: ReadonlyMap<string, ComponentData>,
  protocols: readonly ProtocolData[],
  connections: readonly ConnectionData[],
): ProtocolUsage {
  const ports: ProtocolPortUsage[] = [];
  for (const [componentKey, component] of components) {
    if (component.source !== undefined) continue;
    for (const port of component.ports) {
      if (port.protocol === label) {
        ports.push({
          componentKey,
          componentLabel: component.label,
          portLabel: port.label,
        });
      }
    }
  }
  return {
    ports,
    listedBy: protocols
      .filter(
        (protocol) =>
          protocol.label !== label && protocol.encapsulates.includes(label),
      )
      .map((protocol) => protocol.label),
    connections: connections
      .filter((connection) => connection.protocol === label)
      .map((connection) => connection.ref),
  };
}
