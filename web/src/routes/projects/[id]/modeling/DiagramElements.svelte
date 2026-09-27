<script lang="ts">
import { resolveIcon } from "../../../../iconHelper";
import AnnotationText from "./AnnotationText.svelte";
import DiagramNodeBody from "./DiagramNodeBody.svelte";
import type { DiagramScene } from "./diagramScene";

let {
  scene,
  markerId = "arrow",
  selected = new Set<string>(),
  linked = new Set<string>(),
  onnodeclick,
  onnodehover,
}: {
  /** The resolved diagram. This component only decides how to draw it. */
  scene: DiagramScene;
  markerId?: string;
  /** Node keys drawn with the selection outline. */
  selected?: Set<string>;
  /** Node keys with a detail view — dimmed otherwise, click navigates. */
  linked?: Set<string>;
  onnodeclick?: ((key: string) => void) | undefined;
  /** Hover callback — fired with the node key on enter, `null` on leave. */
  onnodehover?: ((key: string | null, event?: MouseEvent) => void) | undefined;
} = $props();
</script>

<defs>
  <marker
    id={markerId}
    markerWidth="8"
    markerHeight="6"
    refX="8"
    refY="3"
    orient="auto"
  >
    <polygon
      points="0 0, 8 3, 0 6"
      fill="var(--color-base-content)"
      fill-opacity="0.5"
    />
  </marker>
</defs>

<!--
  Nodes paint in scene order, which the scene builder sorted parents-first, so
  a child is never hidden behind its parent's fill.
-->
{#each scene.nodes as node (node.key)}
  <a
  href={onnodeclick ? "#" : undefined}
  aria-label={onnodeclick
      ? `${node.label}${
        linked.has(node.key) ? ", open detailed view" : ", no detailed view"
      }`
      : undefined}
  onclick={onnodeclick
      ? (event) => {
        event.preventDefault();
        onnodeclick(node.key);
      }
      : undefined}
  onmouseenter={onnodehover ? (e) => onnodehover?.(node.key, e) : undefined}
  onmousemove={onnodehover ? (e) => onnodehover?.(node.key, e) : undefined}
  onmouseleave={onnodehover ? (e) => onnodehover?.(null, e) : undefined}
>
  <g
    transform="translate({node.box.x}, {node.box.y})"
    class:cursor-pointer={onnodeclick !== undefined}
    class:opacity-90={onnodeclick !== undefined && !linked.has(node.key)}
  >
    <DiagramNodeBody
      label={node.label}
      width={node.box.width}
      height={node.box.height}
      textAlign={node.box.textAlign}
      icon={resolveIcon(node.icon)}
      color={node.color}
      border={node.border}
      font={node.font}
      selected={selected.has(node.key)}
    />
  </g>
</a>
{/each}

{#each scene.edges as edge (edge.label)}
  <path
  d={edge.d}
  stroke="var(--color-base-content)"
  stroke-opacity="0.35"
  stroke-width="1.5"
  fill="none"
  marker-end="url(#{markerId})"
  style="pointer-events: none"
/>
  <text
  x={(edge.a.x + edge.b.x) / 2}
  y={(edge.a.y + edge.b.y) / 2 - 6}
  fill="var(--color-base-content)"
  fill-opacity="0.5"
  font-size="10"
  text-anchor="middle"
  style="pointer-events: none; user-select: none"
>
    {edge.label}
  </text>
{/each}

{#each scene.annotations as annotation, index (index)}
  <AnnotationText
  text={annotation.text}
  x={annotation.x}
  y={annotation.y}
  scale={annotation.scale}
/>
{/each}
