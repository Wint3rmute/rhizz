<script lang="ts">
  // Centered pill behind a connection label, matching the port-label language:
  // solid fill (primary when selected, base-content otherwise) with
  // background-colored text on top, so the name stays readable over
  // busy canvas geometry. Measures its own text so the box hugs the glyphs.
  let {
    label,
    selected = false,
    x,
    y,
  }: {
    label: string;
    selected?: boolean;
    /** Midpoint anchor (text baseline position, before the pill offset). */
    x: number;
    y: number;
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

  // Fallback estimate until measurement lands (first frame). ~6px per glyph
  // at 10px font (port labels use 5.2 at 9px).
  let textW = $derived(measured ?? label.length * 6);
  const padX = 5;
  const boxH = 15;
  // Baseline-relative: ~11px above baseline, ~4px below for 10px font.
  let boxY = $derived(y - 11);
  let boxX = $derived(x - textW / 2 - padX);
  let boxW = $derived(textW + padX * 2);
  let fill = $derived(
    selected ? "var(--color-primary)" : "var(--color-base-content)",
  );
</script>

<rect
  x={boxX}
  y={boxY}
  width={boxW}
  height={boxH}
  rx="4"
  {fill}
  style="pointer-events: none"
/>
<text
  bind:this={textEl}
  {x}
  {y}
  text-anchor="middle"
  font-size="10"
  font-weight={selected ? "bold" : undefined}
  fill="var(--color-base-200)"
  style="pointer-events: none; user-select: none"
>
  {label}
</text>
