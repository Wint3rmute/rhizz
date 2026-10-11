<script lang="ts">
// One annotation's Markdown text as SVG <text>/<tspan> runs (pure SVG, no
// foreignObject). DiagramCanvas is the only caller, so the modeling page,
// static, embed, and book views cannot drift apart.
import { ANNOTATION_FONT_SIZE, ANNOTATION_LINE_HEIGHT } from "./geometry";
import {
  ANNOTATION_MD_INDENT_PX,
  annotationSvgLines,
} from "./annotationMarkdown";

let {
  text,
  x,
  y,
  scale = 1,
  fill = "var(--color-base-content)",
  pointerEventsNone = true,
}: {
  text: string;
  x: number;
  y: number;
  scale?: number;
  fill?: string;
  pointerEventsNone?: boolean;
} = $props();

const lines = $derived(annotationSvgLines(text));

// Inline-code markers, drawn as their own <rect>s because SVG text has no
// background box. Boxes are measured from the rendered tspans (getBBox), so
// they hug whatever font/scale is active — the SVG half of `.inline-code`
// (app.css). `fill` comes from the same custom property the HTML renderer
// uses. Padding/radius scale with the annotation so the marker stays put.
const CODE_PAD_X = 3;
const CODE_PAD_Y = 2;
const CODE_RADIUS = 4;

interface CodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

let codeBoxes = $state<Record<string, CodeBox>>({});
let textEl = $state<SVGTextElement>();

// getBBox throws while the note is display:none; treat that as "measure later".
function measure(el: SVGGraphicsElement): DOMRect | null {
  try {
    return el.getBBox();
  } catch {
    return null;
  }
}

$effect(() => {
  const el = textEl;
  if (el === undefined) return;
  const next: Record<string, CodeBox> = {};
  for (const [li, line] of lines.entries()) {
    // Fenced code blocks use `span.code` too, but only *inline* spans get a
    // marker (fenced blocks stay plain, matching the HTML renderer).
    if (line.codeBlock === true) continue;
    for (const [si, span] of line.spans.entries()) {
      if (span.code !== true) continue;
      const target = el.querySelector<SVGGraphicsElement>(
        `[data-code="${li}-${si}"]`,
      );
      if (target === null) continue;
      const box = measure(target);
      if (box === null) continue;
      const padX = CODE_PAD_X * scale;
      const padY = CODE_PAD_Y * scale;
      next[`${li}-${si}`] = {
        x: box.x - padX,
        y: box.y - padY,
        width: box.width + 2 * padX,
        height: box.height + 2 * padY,
        rx: CODE_RADIUS * scale,
      };
    }
  }
  codeBoxes = next;
});
</script>

{#each Object.entries(codeBoxes) as [key, box] (key)}
  <rect
  x={box.x}
  y={box.y}
  width={box.width}
  height={box.height}
  rx={box.rx}
  fill="var(--inline-code-bg)"
  style="pointer-events: none"
/>
{/each}

<text
  bind:this={textEl}
  {x}
  {y}
  {fill}
  font-size={ANNOTATION_FONT_SIZE * scale}
  text-anchor="start"
  style={pointerEventsNone
    ? "pointer-events: none; user-select: none"
    : "user-select: none"}
>
  {#each lines as line, li (li)}
    {@const lineSize = line.size ?? 1}
    {@const lineX = x + (line.indent ?? 0) * ANNOTATION_MD_INDENT_PX * scale}
    <tspan
      x={lineX}
      dy={li === 0 ? 0 : ANNOTATION_LINE_HEIGHT * scale}
      font-size={ANNOTATION_FONT_SIZE * lineSize * scale}
      font-weight={line.bold ? "bold" : undefined}
      font-style={line.quote ? "italic" : undefined}
    >
      {#if line.spans.length === 0}
        &nbsp;
      {:else}
        {#each line.spans as span, si (si)}
          <tspan
            data-code={span.code && line.codeBlock !== true
              ? `${li}-${si}`
              : undefined}
            font-weight={span.bold || line.bold ? "bold" : undefined}
            font-style={span.italic || line.quote ? "italic" : undefined}
            text-decoration={span.strike
              ? "line-through"
              : span.link
                ? "underline"
                : undefined}
            font-family={span.code || line.codeBlock ? "monospace" : undefined}
            fill={span.link ? "var(--color-primary)" : undefined}
          >{span.text}</tspan>
        {/each}
      {/if}
    </tspan>
  {/each}
</text>
