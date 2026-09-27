// Builds a DiagramScene from hand-written story data.
//
// Stories for the read-only renderers used to declare arena-indexed
// `components`/`connections`/`boxes` arrays. The renderer now takes a scene
// keyed by component key, so they go through here rather than each spelling
// out a `buildDiagramScene` call.
//
// Story-only scaffolding: production hosts build their scene with
// `sceneFromModel` (see `web/src/modelView.ts`).
import {
  buildDiagramScene,
  type DiagramScene,
  type SceneAnnotationInput,
  type SceneBoxInput,
} from "./diagramScene";

export interface StoryComponent {
  label: string;
  /** Defaults to the label — a flat diagram needs no explicit keys. */
  key?: string;
  /** Key of the parent component, for a nested diagram. */
  parent?: string;
  icon?: string;
  color?: string;
  border?: string;
  font?: string;
}

export interface StoryConnection {
  from: string;
  to: string;
  label: string;
}

export function storyScene(
  components: readonly StoryComponent[],
  boxes: Readonly<Record<string, SceneBoxInput>>,
  connections: readonly StoryConnection[] = [],
  annotations: readonly SceneAnnotationInput[] = [],
): DiagramScene {
  return buildDiagramScene({
    components: components.map((component) => ({
      key: component.key ?? component.label,
      label: component.label,
      ...(component.parent ? { parentKey: component.parent } : {}),
      ...(component.icon ? { icon: component.icon } : {}),
      ...(component.color ? { color: component.color } : {}),
      ...(component.border ? { border: component.border } : {}),
      ...(component.font ? { font: component.font } : {}),
    })),
    connections: connections.map((connection) => ({
      label: connection.label,
      fromKey: connection.from,
      toKey: connection.to,
    })),
    boxes,
    annotations,
  });
}
