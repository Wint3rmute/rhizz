<script lang="ts">
// One annotation's Markdown text as SVG <text>/<tspan> runs (pure SVG, no
// foreignObject). Shared by the interactive canvas (+page.svelte, both the
// idle and the in-editing states) and DiagramElements (static/embed/book),
// so all four render paths can never drift apart.
import {
  ANNOTATION_FONT_SIZE,
  ANNOTATION_LINE_HEIGHT,
} from "./geometry";
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
</script>
</script>

<text
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
