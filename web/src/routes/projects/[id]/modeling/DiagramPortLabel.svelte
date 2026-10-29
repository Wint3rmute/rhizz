<script lang="ts">
  // Tight rectangular tag behind a port label. Measures its own text so the
  // box hugs the glyphs instead of using a per-character estimate, and uses
  // the same fill / border / radius language as DiagramNodeBody so it reads
  // as part of the node rather than a floating pill.
  import type { ConnectionSide } from "./geometry";
  import { colorToSvgStroke } from "./visuals";

  let {
    label,
    side,
    color,
  }: {
    label: string;
    side: ConnectionSide;
    /** Component node color — the port fill follows it. */
    color?: string | undefined;
  } = $props();

  let textEl: SVGTextElement | undefined = $state();
  let measured: number | undefined = $state();

  $effect(() => {
    void label;
    if (!textEl) return;
    try {
      const w = textEl.getComputedTextLength();
      measured = w > 0 ? w : undefined;
    } catch {
      measured = undefined;
    }
  });

  let tx = $derived(side === "left" ? 4 : side === "right" ? -4 : 0);
  let ty = $derived(side === "top" ? 10 : side === "bottom" ? -3 : 3.5);
  let anchor = $derived(
    side === "left" ? "start" : side === "right" ? "end" : "middle",
  );

  // Fallback estimate until measurement lands (first frame).
  let textW = $derived(measured ?? label.length * 5.2);
  const padX = 4;
  const boxH = 13;
  // Baseline-relative: ~10px above baseline, ~3px below for 9px font.
  let boxY = $derived(ty - 10);
  let boxX = $derived(
    side === "left"
      ? tx - padX
      : side === "right"
        ? tx - textW - padX
        : tx - textW / 2 - padX,
  );
  let boxW = $derived(textW + padX * 2);
  let fill = $derived(colorToSvgStroke(color) ?? "var(--color-base-content)");

  // Only the free corners are rounded — the edge merged with the node outline
  // stays sharp so the two borders read as one. SVG rect can't do per-corner
  // radii, so the box is a path.
  const cornerR = 3;
  let radii = $derived(
    side === "left"
      ? { tl: 0, tr: cornerR, br: cornerR, bl: 0 }
      : side === "right"
        ? { tl: cornerR, tr: 0, br: 0, bl: cornerR }
        : side === "top"
          ? { tl: 0, tr: 0, br: cornerR, bl: cornerR }
          : { tl: cornerR, tr: cornerR, br: 0, bl: 0 },
  );
  let boxPath = $derived.by(() => {
    const x = boxX;
    const y = boxY;
    const w = boxW;
    const h = boxH;
    const { tl, tr, br, bl } = radii;
    let d = `M ${String(x + tl)} ${String(y)}`;
    d += ` H ${String(x + w - tr)}`;
    d +=
      tr > 0
        ? ` Q ${String(x + w)} ${String(y)} ${String(x + w)} ${String(y + tr)}`
        : ` L ${String(x + w)} ${String(y)}`;
    d += ` V ${String(y + h - br)}`;
    d +=
      br > 0
        ? ` Q ${String(x + w)} ${String(y + h)} ${String(x + w - br)} ${String(y + h)}`
        : ` L ${String(x + w)} ${String(y + h)}`;
    d += ` H ${String(x + bl)}`;
    d +=
      bl > 0
        ? ` Q ${String(x)} ${String(y + h)} ${String(x)} ${String(y + h - bl)}`
        : ` L ${String(x)} ${String(y + h)}`;
    d += ` V ${String(y + tl)}`;
    d +=
      tl > 0
        ? ` Q ${String(x)} ${String(y)} ${String(x + tl)} ${String(y)}`
        : ` L ${String(x)} ${String(y)}`;
    return `${d} Z`;
  });
</script>

<path
  d={boxPath}
  {fill}
  stroke={fill}
  stroke-width="1"
  style="pointer-events: none"
/>
<text
  bind:this={textEl}
  x={tx}
  y={ty}
  text-anchor={anchor}
  font-size="9"
  fill="var(--color-base-200)"
  style="pointer-events: none; user-select: none"
>
  {label}
</text>
