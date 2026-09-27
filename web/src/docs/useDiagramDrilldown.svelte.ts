// The host side of a drill-down diagram: hovering a node shows its Markdown
// doc, clicking it navigates to that component's detail view.
//
// This exists because Explore and the chromeless embed each grew their own
// copy of this logic, and they drifted: the scroll-invariant popup anchoring
// below was written for one and never applied to the other, so the embed's
// popup detached from the cursor on scroll. One module, one behaviour.
//
// The two hosts are near-identical in *policy* — how they navigate and how
// they report a missing detail view — so that is all they inject. Everything
// reactive lives in the host's own component scope, which is where Svelte
// tracks it reliably; the tricky parts (anchor math, the scroll listener, doc
// resolution) are shared as plain functions and are unit-testable without a
// component.
import type { Dirent } from "../vfs/fs";
import type { DiagramScene } from "../routes/projects/[id]/modeling/diagramScene";
import { findComponentDiagram } from "../routes/projects/[id]/explore/navigation";
import { type ProjectDoc, withFullNameHeader } from "./docs";

/** Where a popup should sit, in container-relative pixels. */
export interface Anchor {
  x: number;
  y: number;
}

/**
 * Re-anchors a cursor-tracked popup after the container has moved.
 *
 * The anchor is derived from a *viewport* cursor position rather than measured
 * once: a scroll between the hover and the paint would otherwise leave the
 * popup stranded where the container used to be, and it can never self-heal.
 * Deriving also makes a screenshot of an open popup reproducible.
 *
 * Capture phase, because `scroll` does not bubble — a document-level capture
 * listener sees a scroll of anything below it, a window-level one would not.
 */
export function trackPopupAnchor(
  reposition: () => void,
): () => void {
  const onScroll = (): void => {
    reposition();
  };
  document.addEventListener("scroll", onScroll, true);
  return () => {
    document.removeEventListener("scroll", onScroll, true);
  };
}

/** The anchor for a viewport-space cursor position inside `container`. */
export function anchorAt(
  container: HTMLElement | null | undefined,
  client: Anchor | null,
): Anchor | null {
  if (container == null || client === null) return null;
  const rect = container.getBoundingClientRect();
  return { x: client.x - rect.left, y: client.y - rect.top };
}

/**
 * The detail view a node drills into, or null when it has none. Matches the
 * qualified path first, then the bare label, so an ambiguous bare label never
 * shadows an exact match.
 */
export function detailViewFor(
  entries: readonly Dirent[],
  scene: DiagramScene,
  key: string,
): Dirent | undefined {
  const node = scene.byKey.get(key);
  if (node === undefined) return undefined;
  return findComponentDiagram([...entries], node.label, key);
}

/** The keys of `scene`'s nodes that have a detail view. */
export function linkedKeys(
  entries: readonly Dirent[],
  scene: DiagramScene,
): string[] {
  return scene.nodes
    .filter((node) => detailViewFor(entries, scene, node.key) !== undefined)
    .map((node) => node.key);
}

/**
 * The Markdown to show for a hovered node, or null when it has no doc.
 * Matched by the component's unique label rather than its qualified path: a
 * reusable component has one doc however many places it is instantiated. A
 * `full_name` heads the result as an L1, so the name on the canvas and the
 * name in the doc read as the same thing.
 */
export function docFor(
  docs: readonly ProjectDoc[],
  scene: DiagramScene,
  key: string | null,
): string | null {
  if (key === null) return null;
  const node = scene.byKey.get(key);
  if (node === undefined) return null;
  const content = docs.find((doc) => doc.key === node.label)?.content;
  if (content === undefined) return null;
  return withFullNameHeader(content, node.fullName);
}
