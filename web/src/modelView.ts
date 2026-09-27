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
import { componentKeyAt } from "./modelKeys";
import {
  buildDiagramScene,
  type ConnectionSide,
  type DiagramScene,
  type SceneAnnotationInput,
  type SceneBoxInput,
  type SceneComponentInput,
  type SceneConnectionInput,
  type ScenePortInput,
} from "./routes/projects/[id]/modeling/diagramScene";
import type { BorderStyle } from "./routes/projects/[id]/modeling/visuals";
import {
  type ComponentColor,
  type ComponentFont,
  DEFAULT_COLOR,
  DEFAULT_FONT,
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
  full_name?: string;
  icon?: string | undefined;
  color: ComponentColor;
  border: BorderStyle;
  font: ComponentFont;
  tags?: string[];
  leaf: boolean;
  ports: PortData[];
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
    from: { component: number; port?: number | null };
    to: { component: number; port?: number | null };
  }[];
}

/** One entry of {@link RawModelPayload}'s component arena. */
export type RawComponent = NonNullable<RawModelPayload["components"]>[number];
/** One entry of {@link RawModelPayload}'s port arena. */
export type RawPort = NonNullable<RawModelPayload["ports"]>[number];
/** One entry of {@link RawModelPayload}'s connection arena. */
export type RawConnection = NonNullable<
  RawModelPayload["connections"]
>[number];

function toRole(role: string | undefined): PortData["role"] {
  const normalized = role?.toLowerCase();
  return normalized === "provider" || normalized === "consumer"
    ? normalized
    : "peer";
}

function toBorderStyle(border: string | undefined): BorderStyle {
  return border === "dashed" || border === "dotted" ? border : "solid";
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
      full_name: component.full_name ?? "",
      icon: component.icon ?? "",
      color: component.color === "" || component.color === undefined
        ? DEFAULT_COLOR
        : component.color,
      border: toBorderStyle(component.border),
      font: component.font === "" || component.font === undefined
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

/** Per-connection routing overrides, as persisted in `views/*.hcl`. */
export interface SceneRouting {
  startSide?: ConnectionSide | undefined;
  endSide?: ConnectionSide | undefined;
}

/**
 * Projects the compiled model + a view's layout into a {@link DiagramScene} —
 * the single input every diagram renderer consumes.
 *
 * Visual attributes and ports come from {@link componentDataByKey}, the same
 * projection the inspector edits, so the canvas and the inspector can never
 * disagree about a component's icon, colour or ports. Layout is keyed by the
 * canonical component key, so renaming a component moves its box with it
 * instead of silently reattaching the box to whatever now sits at that arena
 * index.
 */
export function sceneFromModel(
  model: ModelJS | undefined,
  boxes: Readonly<Record<string, SceneBoxInput>>,
  annotations: readonly SceneAnnotationInput[] = [],
  routing: Readonly<Record<string, SceneRouting>> = {},
  include?: (key: string) => boolean,
): DiagramScene {
  if (model === undefined) {
    return buildDiagramScene({ components: [], connections: [], boxes: {} });
  }

  const raw = model.to_js() as RawModelPayload;
  const components = raw.components ?? [];
  const keys = model.component_keys();
  const data = componentDataByKey(model);
  const keyAt = (index: number): string => componentKeyAt(keys, index);

  const sceneComponents: SceneComponentInput[] = components.map(
    (component, index) => {
      const key = keyAt(index);
      const view = data.get(key);
      const parentIndex = component.parent?.Component;
      const ports: ScenePortInput[] | undefined = view?.ports.map((port) => ({
        label: port.label,
        role: port.role,
        // `componentDataByKey` normalises an absent protocol to ""; the scene
        // distinguishes "no protocol" (absent) from an empty one.
        ...(port.protocol ? { protocol: port.protocol } : {}),
      }));
      return {
        key,
        label: component.label,
        ...(parentIndex === undefined ? {} : { parentKey: keyAt(parentIndex) }),
        leaf: component.leaf ?? false,
        // An empty icon string means "no icon" — consumers test for `undefined`.
        ...(view?.icon ? { icon: view.icon } : {}),
        ...(view
          ? { color: view.color, border: view.border, font: view.font }
          : {}),
        ...(ports && ports.length > 0 ? { ports } : {}),
      };
    },
  );

  const sceneConnections: SceneConnectionInput[] = (raw.connections ?? []).map(
    (connection) => {
      const route = routing[connection.label];
      return {
        label: connection.label,
        fromKey: keyAt(connection.from.component),
        toKey: keyAt(connection.to.component),
        ...(route?.startSide ? { startSide: route.startSide } : {}),
        ...(route?.endSide ? { endSide: route.endSide } : {}),
      };
    },
  );

  return buildDiagramScene({
    components: sceneComponents,
    connections: sceneConnections,
    boxes,
    annotations,
    include,
  });
}
