<script lang="ts">
import {
  type Box,
  computeRenderOrder,
  computeVisibleConnections,
  elbowPath,
  type TextAlign,
  textPosition,
} from "./geometry";
import { resolveIcon } from "../../../../iconHelper";
import {
  borderStyleToSvg,
  fontStyleToSvg,
  SELECTION_OUTLINE_DASHARRAY,
  SELECTION_OUTLINE_OPACITY,
  selectionOutlineRect,
} from "./visuals";
import type {
  DiagramStaticAnnotation,
  DiagramStaticBox,
  DiagramStaticComponent,
  DiagramStaticConnection,
} from "./types";

let {
  components = [],
  connections = [],
  boxes = {},
  annotations = [],
  markerId = "arrow",
  selected = new Set<number>(),
  linked = new Set<number>(),
  onnodeclick,
  onnodehover,
}: {
  components: DiagramStaticComponent[];
  connections: DiagramStaticConnection[];
  boxes: Record<number, DiagramStaticBox>;
  /** View-level text annotations (absolute canvas positions). */
  annotations?: DiagramStaticAnnotation[];
  markerId?: string;
  /** Component indices to show as selected (drawn with a transparent dotted outline on top). */
  selected?: Set<number>;
  linked?: Set<number>;
  onnodeclick?: ((index: number) => void) | undefined;
  /** Optional hover callback — fired with the component index + mouse event on enter, then with `null` on leave. */
  onnodehover?:
    | ((index: number | null, event?: MouseEvent) => void)
    | undefined;
} = $props();

function nodeBox(index: number): (Box & { textAlign: TextAlign }) | null {
  const box = boxes[index];
  if (!box) return null;
  return { ...box, textAlign: box.textAlign ?? "center" };
}

function parentOf(index: number): number | undefined {
  return components[index]?.parent_component_index;
}

let renderOrder = $derived(
  computeRenderOrder(Object.keys(boxes).map(Number), parentOf),
);

let visibleConnections = $derived(
  computeVisibleConnections(connections, (i) => nodeBox(i)),
);
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

{#each renderOrder as index (index)}
  {@const box = nodeBox(index)}
  {@const component = components[index]}
  {#if box && component}
{@const textPos = textPosition(box.textAlign, box.width, box.height)}
    {@const icon = resolveIcon(component.icon)}
    {@const borderSvg = borderStyleToSvg({
      color: component.color,
      border: component.border,
    })}
    {@const fontSvg = fontStyleToSvg(component.font)}
    <a
  href={onnodeclick ? "#" : undefined}
  aria-label={onnodeclick
        ? `${component.label}${linked.has(index) ? ", open detailed view" : ", no detailed view"}`
        : undefined}
  onclick={onnodeclick
        ? (event) => {
          event.preventDefault();
          onnodeclick(index);
        }
        : undefined}
  onmouseenter={onnodehover ? (e) => onnodehover?.(index, e) : undefined}
  onmousemove={onnodehover ? (e) => onnodehover?.(index, e) : undefined}
  onmouseleave={onnodehover ? (e) => onnodehover?.(null, e) : undefined}
>
  <g
    transform="translate({box.x}, {box.y})"
    class:cursor-pointer={onnodeclick !== undefined}
    class:opacity-90={onnodeclick !== undefined && !linked.has(index)}
  >
      <rect
        width={box.width}
        height={box.height}
        rx="5"
        stroke={borderSvg.stroke ?? "var(--color-base-content)"}
        stroke-width="1"
        stroke-dasharray={borderSvg.dasharray}
        fill="var(--color-base-200)"
      />
      {#if selected.has(index)}
        <!-- Selection indicator: a 50%-transparent dotted outline drawn on
             top of the node's own border, so the component's style (color /
             border) stays visible and isn't obscured. Mirrors the interactive
             canvas's selection rendering. -->
        {@const outline = selectionOutlineRect(box.width, box.height)}
        <rect
          x={outline.x}
          y={outline.y}
          width={outline.width}
          height={outline.height}
          rx="5"
          fill="none"
          stroke="var(--color-primary)"
          stroke-opacity={SELECTION_OUTLINE_OPACITY}
          stroke-width="1.5"
          stroke-dasharray={SELECTION_OUTLINE_DASHARRAY}
          style="pointer-events: none"
        />
      {/if}
      {#if icon}
        {#if box.textAlign === "top-left"}
          <svg
            x={8}
            y={8}
            width="14"
            height="14"
            viewBox="0 0 {icon.width} {icon.height}"
            fill="var(--color-base-content)"
            opacity="0.85"
          >
            <path d={icon.svgPath} />
          </svg>
          <text
            x={26}
            y={textPos.y}
            fill="var(--color-base-content)"
            text-anchor="start"
            dominant-baseline={textPos.baseline}
            font-weight={fontSvg.fontWeight}
            font-style={fontSvg.fontStyle}
            text-decoration={fontSvg.textDecoration}
            style="pointer-events: none; user-select: none"
          >
            {component.label}
          </text>
        {:else if box.textAlign === "top-center"}
          {@const estimatedWidth = Math.min(box.width - 16, component.label.length * 7.5 + 18)}
          {@const startX = Math.max(8, (box.width - estimatedWidth) / 2)}
          <svg
            x={startX}
            y={8}
            width="14"
            height="14"
            viewBox="0 0 {icon.width} {icon.height}"
            fill="var(--color-base-content)"
            opacity="0.85"
          >
            <path d={icon.svgPath} />
          </svg>
          <text
            x={startX + 18}
            y={textPos.y}
            fill="var(--color-base-content)"
            text-anchor="start"
            dominant-baseline={textPos.baseline}
            font-weight={fontSvg.fontWeight}
            font-style={fontSvg.fontStyle}
            text-decoration={fontSvg.textDecoration}
            style="pointer-events: none; user-select: none"
          >
            {component.label}
          </text>
        {:else}
          <svg
            x={box.width / 2 - 9}
            y={box.height / 2 - 20}
            width="18"
            height="18"
            viewBox="0 0 {icon.width} {icon.height}"
            fill="var(--color-base-content)"
            opacity="0.85"
          >
            <path d={icon.svgPath} />
          </svg>
          <text
            x={box.width / 2}
            y={box.height / 2 + 10}
            fill="var(--color-base-content)"
            text-anchor="middle"
            dominant-baseline="middle"
            font-weight={fontSvg.fontWeight}
            font-style={fontSvg.fontStyle}
            text-decoration={fontSvg.textDecoration}
            style="pointer-events: none; user-select: none"
          >
            {component.label}
          </text>
        {/if}
      {:else}
        <text
          x={textPos.x}
          y={textPos.y}
          fill="var(--color-base-content)"
          text-anchor={textPos.anchor}
          dominant-baseline={textPos.baseline}
          font-weight={fontSvg.fontWeight}
          font-style={fontSvg.fontStyle}
          text-decoration={fontSvg.textDecoration}
          style="pointer-events: none; user-select: none"
        >
          {component.label}
        </text>
      {/if}
    </g>
</a>
  {/if}
{/each}

{#each visibleConnections as { conn, a, b, orientation } (`${conn.label}-${conn.from}-${conn.to}`)}
  <path
  d={elbowPath(a.x, a.y, b.x, b.y, orientation)}
  stroke="var(--color-base-content)"
  stroke-opacity="0.35"
  stroke-width="1.5"
  fill="none"
  marker-end="url(#{markerId})"
  style="pointer-events: none"
/>
  <text
  x={(a.x + b.x) / 2}
  y={(a.y + b.y) / 2 - 6}
  fill="var(--color-base-content)"
  fill-opacity="0.5"
  font-size="10"
  text-anchor="middle"
  style="pointer-events: none; user-select: none"
>
    {conn.label}
  </text>
{/each}

{#each annotations as ann (ann.text + ann.x + ann.y)}
  <text
  x={ann.x}
  y={ann.y}
  fill="var(--color-base-content)"
  font-size={12 * (ann.scale ?? 1)}
  text-anchor="start"
  style="pointer-events: none; user-select: none; white-space: pre"
>
    {ann.text}
  </text>
{/each}
