<script lang="ts">
// One diagram node's box: its border/fill, the selection outline, and the
// icon+label block. This is the whole of what the interactive canvas and the
// static/embed renderers have in common, so it lives here once — callers own
// the surrounding positioned <g> (transform, event handlers) and any
// interaction chrome around it (resize/port handles, reparent highlight).
//
// Icon and label placement comes from geometry.nodeLabelLayout, a pure
// function, so the three text alignments can't drift between renderers.
import type { ResolvedIcon } from "../../../../iconHelper";
import { nodeLabelLayout, type TextAlign } from "./geometry";
import {
  borderStyleToSvg,
  fontStyleToSvg,
  SELECTION_OUTLINE_DASHARRAY,
  SELECTION_OUTLINE_OPACITY,
  selectionOutlineRect,
} from "./visuals";

let {
  label,
  width,
  height,
  textAlign = "center",
  icon = null,
  color,
  border,
  font,
  selected = false,
}: {
  label: string;
  width: number;
  height: number;
  textAlign?: TextAlign;
  /** Resolved FontAwesome glyph, or null to render the label alone. */
  icon?: ResolvedIcon | null;
  /** Model-level visuals; mapped to SVG presentation values by ./visuals. */
  color?: string | undefined;
  border?: string | undefined;
  font?: string | undefined;
  /** Draws the dotted primary outline on top of the node's own border. */
  selected?: boolean;
} = $props();

let borderSvg = $derived(borderStyleToSvg({ color, border }));
let fontSvg = $derived(fontStyleToSvg(font));
let layout = $derived(
  nodeLabelLayout(textAlign, label, width, height, icon !== null),
);
let iconBox = $derived(layout.icon);
let outline = $derived(selectionOutlineRect(width, height));
</script>

<g>
  <rect
    {width}
    {height}
    rx="5"
    stroke={borderSvg.stroke ?? "var(--color-base-content)"}
    stroke-width="1"
    stroke-dasharray={borderSvg.dasharray}
    fill="var(--color-base-200)"
  />

  {#if selected}
    <!-- Selection indicator: a partly-transparent dotted outline drawn on top
         of the node's own border, so the component's style (color / border)
         stays visible and isn't obscured. -->
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

  {#if icon && iconBox}
    <svg
      x={iconBox.x}
      y={iconBox.y}
      width={iconBox.size}
      height={iconBox.size}
      viewBox="0 0 {icon.width} {icon.height}"
      fill="var(--color-base-content)"
      opacity="0.85"
    >
      <path d={icon.svgPath} />
    </svg>
  {/if}

  <text
    x={layout.text.x}
    y={layout.text.y}
    fill="var(--color-base-content)"
    text-anchor={layout.text.anchor}
    dominant-baseline={layout.text.baseline}
    font-weight={fontSvg.fontWeight}
    font-style={fontSvg.fontStyle}
    text-decoration={fontSvg.textDecoration}
    style="pointer-events: none; user-select: none"
  >
    {label}
  </text>
</g>
