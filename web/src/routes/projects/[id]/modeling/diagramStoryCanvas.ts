// DOM helpers for Storybook stories that drive the Modeling page's canvas
// (`Pages/Diagrams/*`): finding the canvas and its nodes, reading/deriving
// world coordinates, and pinning the story root so the page lays out at a
// measurable size. Pure DOM — no Svelte, no app imports — so a story can use
// it without pulling the page's internals in.
//
// Not unit tested: every function here is exercised end-to-end by the stories
// that use it (they assert placement geometry through these very helpers).
import { expect, userEvent, waitFor } from "storybook/test";

/** A node's or note's rendered box, in screen coordinates. */
export interface StoryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Width/height forced on a story root. The story runner's own viewport is
// phone-sized, where the page's two w-64 sidebars squeeze the canvas to zero
// width and nothing can be measured; the runner's viewport can't be changed
// per story (the mobile stories depend on it being phone-sized).
export const STORY_SIZE = { width: "1280px", height: "800px" } as const;

// How long to wait for the page to catch up with a resized story root. The
// default (1s) is tight when the whole story suite runs in parallel.
const SETTLE_TIMEOUT_MS = 5000;

export function canvasOf(canvasElement: HTMLElement): SVGSVGElement {
  const canvas = canvasElement.querySelector<SVGSVGElement>(
    '[data-testid="diagram-canvas"]',
  );
  if (!canvas) throw new Error("diagram canvas not rendered");
  return canvas;
}

// Sizes the story root so the page's canvas has room, then waits until the
// page has picked the new size up. A flex row of a definite size is what the
// app shell hands the page in the real app; both dimensions have to be
// pinned, because the canvas is otherwise sized by its own content —
// mounting an inspector would then resize it *after* the thing under test was
// placed, and the placement would no longer match what the story measures.
export async function pinCanvasSize(
  canvasElement: HTMLElement,
): Promise<SVGSVGElement> {
  const canvas = canvasOf(canvasElement);
  canvasElement.style.display = "flex";
  canvasElement.style.width = STORY_SIZE.width;
  canvasElement.style.height = STORY_SIZE.height;

  // Start from a known view. The page persists its pan/zoom per origin, and
  // the diagram-load effect zooms to fit whatever is placed — so a story (or
  // an earlier one, sharing this origin's localStorage) can leave a zoomed
  // view behind, and then the viewBox would never match the element rect.
  await userEvent.click(buttonByLabel(canvasElement, "Reset View"));
  // Clicking focuses that (off-screen) button, and focusing scrolls whatever
  // ancestor scrolls — which would move the canvas out from under every
  // screen coordinate measured afterwards. Undo the scroll; the stories then
  // measure and interact with the canvas at a known position.
  unscroll(canvasElement);
  // The element's rect is CSS-driven and resizes immediately, while the page
  // picks the new size up through its bound clientWidth/Height a tick later.
  let pinned: { left: number; top: number } | null = null;
  await waitFor(async () => {
    const [, , viewWidth, viewHeight] = viewBoxOf(canvas);
    const { left, top, width, height } = canvas.getBoundingClientRect();
    pinned ??= { left, top };
    // …and the position itself has to hold still while the page catches up.
    await expect(left, "canvas left").toBe(pinned.left);
    await expect(top, "canvas top").toBe(pinned.top);
    await expect(viewWidth, "viewBox width").toBeGreaterThan(0);
    await expect(viewHeight, "viewBox height").toBeGreaterThan(0);
    await expect(
      Math.abs(viewWidth - width),
      "viewBox width should match the element rect",
    ).toBeLessThanOrEqual(1);
    await expect(
      Math.abs(viewHeight - height),
      "viewBox height should match the element rect",
    ).toBeLessThanOrEqual(1);
  }, { timeout: SETTLE_TIMEOUT_MS });
  return canvas;
}

// Rewinds any horizontal scroll in the story's ancestor chain (the oversized
// root overflows the runner's viewport) so screen coordinates are measured
// from a known position.
function unscroll(canvasElement: HTMLElement): void {
  for (
    let el: HTMLElement | null = canvasElement.parentElement;
    el !== null;
    el = el.parentElement
  ) {
    if (el.scrollLeft !== 0) el.scrollLeft = 0;
  }
  const scroller = canvasElement.ownerDocument.scrollingElement;
  if (scroller && scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
}

// The canvas viewBox — `view.x view.y width/zoom height/zoom` — maps screen
// coordinates to world ones, so assertions go through it and therefore hold
// whatever pan/zoom the view happens to be in.
export function viewBoxOf(
  svg: SVGSVGElement,
): [number, number, number, number] {
  const raw = svg.getAttribute("viewBox");
  if (raw === null) throw new Error("canvas has no viewBox");
  return raw.split(/\s+/).map(Number) as [number, number, number, number];
}

export function toWorld(svg: SVGSVGElement, clientX: number, clientY: number) {
  const box = svg.getBoundingClientRect();
  const [viewX, viewY, viewWidth, viewHeight] = viewBoxOf(svg);
  return {
    x: viewX + (clientX - box.left) * (viewWidth / box.width),
    y: viewY + (clientY - box.top) * (viewHeight / box.height),
  };
}

export function centerOf(box: StoryRect) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// A node's label sits in the middle of its box, so the label's rect tracks
// the box's position exactly, on both axes.
export function rectOf(element: Element): StoryRect {
  const box = element.getBoundingClientRect();
  return {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
  };
}

// The placed node carrying `label`: its label text, up to the positioned
// group that holds the whole node.
export function placedNode(
  canvasElement: HTMLElement,
  label: string,
): SVGGElement {
  for (const text of canvasElement.querySelectorAll<SVGTextElement>("text")) {
    if (text.textContent.trim() !== label) continue;
    const node = text.closest<SVGGElement>("g[transform]");
    if (node) return node;
  }
  throw new Error(`no placed node labeled "${label}"`);
}

// The node group's `translate(x, y)` — the box's world-space top-left, read
// straight off the transform, so a position assertion needs no view math.
export function nodeOrigin(node: SVGGElement): { x: number; y: number } {
  const match = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(
    node.getAttribute("transform") ?? "",
  );
  if (!match) throw new Error("node has no translate transform");
  return { x: Number(match[1]), y: Number(match[2]) };
}

// Every label rendered on the canvas itself. Stories assert against this
// rather than a `within()` over the SVG (testing-library's queries are typed
// for HTMLElement) because the sidebar tree shows component labels too — a
// story-scoped query would match the node *and* its tree row.
export function canvasTexts(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll<SVGTextElement>("text")].map((t) =>
    t.textContent.trim()
  );
}

// A button by its trimmed label — the toolbar's actions ("Snap to Grid", …)
// and the sidebar tree's rows are all plain buttons with no accessible name
// beyond their own text.
export function buttonByLabel(
  canvasElement: HTMLElement,
  label: string,
): HTMLButtonElement {
  for (
    const button of canvasElement.querySelectorAll<HTMLButtonElement>("button")
  ) {
    if (button.textContent.trim() === label) return button;
  }
  throw new Error(`no button labeled "${label}"`);
}

// The sidebar tree row's place/unplace checkbox for a component label. The
// checkbox itself carries no accessible name, so the row is found through its
// (label) button and the checkbox read from that row.
export function placeCheckbox(
  canvasElement: HTMLElement,
  label: string,
): HTMLInputElement {
  const row = buttonByLabel(canvasElement, label).parentElement;
  const checkbox = row?.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!checkbox) throw new Error(`row "${label}" has no place checkbox`);
  return checkbox;
}
