// Pure helpers describing the diagram's background grid as a chain of
// nested SVG patterns — one per "graduation" level (e.g. lines every 10,
// 100 and 1000 world units), each drawn more visibly than the last. Kept
// dependency-free (mirroring visuals.ts) so the graduation ladder is a
// single, unit-testable source of truth shared by the interactive canvas
// and any static/embed renderer.
//
// How the nesting works: the finest pattern's tile draws faint lines on
// its own right/bottom edges. Every coarser pattern is a tile of its own
// size *filled* with the next-finest pattern (aligned to the same
// user-space origin via patternUnits="userSpaceOnUse") with its bolder
// edge lines drawn on top. A canvas <rect> fills with the coarsest
// pattern, so lines at every level stay aligned to world coordinates and
// pan/zoom for free with the SVG viewBox — no JS math needed.
import { colorToSvgStroke } from "./visuals";

/** Spacing of the finest grid lines, in world (SVG) units. */
export const GRID_BASE_SPACING = 10;

/** Visual style of one grid graduation level. */
export interface GridGraduation {
  /** Line spacing in world units; must be a multiple of `GRID_BASE_SPACING`. */
  multiple: number;
  /** SVG stroke width of this level's lines, in world units. */
  strokeWidth: number;
  /** Stroke opacity — coarser levels are more opaque than finer ones. */
  strokeOpacity: number;
  /** daisyUI theme token or raw CSS color; falls back to base-content when unset. */
  stroke?: string | undefined;
}

// The tunable graduation ladder. Tweak the multiples (10/100/1000) or the
// per-level thickness/opacity/color here — nothing else depends on the
// specific values, only on the ordering (finest → coarsest) and on each
// multiple being a multiple of GRID_BASE_SPACING.
export const GRID_GRADUATIONS: readonly GridGraduation[] = [
  { multiple: 10, strokeWidth: 1, strokeOpacity: 0.08 },
  { multiple: 100, strokeWidth: 1.5, strokeOpacity: 0.28 },
  // Maybe add this later if users complain..
  // { multiple: 1000, strokeWidth: 2.0, strokeOpacity: 0.35 },
] as const;

/** A ready-to-render SVG `<pattern>` descriptor for one graduation level. */
export interface GridPatternDescriptor {
  /** Unique pattern id, e.g. `Grid-g100`. */
  id: string;
  /** Tile size in world units (= this level's multiple). */
  size: number;
  /** Stroke color for this level's edge lines, already converted to an SVG value. */
  stroke: string | undefined;
  strokeWidth: number;
  strokeOpacity: number;
  /** Id of the next-finest pattern filling this tile, or undefined for the finest level. */
  fill: string | undefined;
}

// Returns the graduation patterns ordered finest → coarsest. The coarsest
// pattern (the last element) is the one a canvas rect should fill with;
// every other pattern is only referenced — via `fill` — by the next
// coarser one, forming a chain.
//
// Throws if a graduation's multiple isn't a multiple of `baseSpacing`:
// misaligned multiples would render a grid whose lines drift off the
// base grid, which is better caught loudly here (the ladder is a
// developer-tuned constant) than silently mis-rendered.
export function buildGraduatedGridPatterns(
  graduations: readonly GridGraduation[] = GRID_GRADUATIONS,
  baseSpacing: number = GRID_BASE_SPACING,
  idPrefix = "Grid",
): GridPatternDescriptor[] {
  const sorted = [...graduations]
    .filter((g) => g.multiple > 0)
    .sort((a, b) => a.multiple - b.multiple)
    .filter((g, i, arr) => i === 0 || g.multiple !== arr[i - 1]?.multiple);

  for (const g of sorted) {
    if (g.multiple % baseSpacing !== 0) {
      throw new RangeError(
        `grid graduation multiple ${
          String(g.multiple)
        } is not a multiple of the base spacing ${String(baseSpacing)}`,
      );
    }
  }

  return sorted.map((g, i) => {
    const previous = sorted[i - 1];
    return {
      id: `${idPrefix}-g${String(g.multiple)}`,
      size: g.multiple,
      stroke: colorToSvgStroke(g.stroke),
      strokeWidth: g.strokeWidth,
      strokeOpacity: g.strokeOpacity,
      fill: previous !== undefined
        ? `${idPrefix}-g${String(previous.multiple)}`
        : undefined,
    };
  });
}
