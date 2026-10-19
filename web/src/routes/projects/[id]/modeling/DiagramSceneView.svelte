<script lang="ts">
  // Presents a DiagramScene with the shared camera/scene tween. Hosts hand
  // over the scene they want on screen plus a stable `viewKey` for the view
  // being shown; when the key changes, the stage tweens from the currently
  // displayed scene to the new one (320ms, honoring prefers-reduced-motion).
  // The same key re-supplied (e.g. an async layout resolving for the view
  // already on screen) is a cut, never a re-tween.
  //
  // This is the single home of the present loop that DiagramViewer and the
  // book-example embed used to duplicate; hosts keep chrome, empty/crash
  // states, and hover/navigation callbacks.
  import { untrack } from "svelte";
  import { fitCamera, sceneBounds } from "./blend";
  import DiagramCanvas from "./DiagramCanvas.svelte";
  import type { DiagramNode, DiagramScene } from "./scene";
  import { createDiagramTransition } from "./transition.svelte";

  let {
    scene,
    viewKey = null,
    linkNodes = false,
    linkLabel,
    onNodeClick,
    onNodeHover,
  }: {
    /** The scene to present; tweens to it when `viewKey` changes. */
    scene: DiagramScene;
    /**
     * Identity of the view being shown. A change triggers a tween; `null`
     * suppresses presentation until the first real view is known.
     */
    viewKey?: string | null;
    /** Forwarded to DiagramCanvas (read-only DOM contract, labels, hit handling). */
    linkNodes?: boolean;
    linkLabel?: ((node: DiagramNode) => string) | undefined;
    onNodeClick?: ((index: number) => void) | undefined;
    onNodeHover?:
      ((index: number | null, event?: MouseEvent) => void) | undefined;
  } = $props();

  const stage = createDiagramTransition();
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let presentedKey: string | null = null;

  $effect(() => {
    if (viewKey === null) return;
    if (viewportWidth === 0 || viewportHeight === 0) return;
    // Nothing on the canvas yet (layout still loading, keys not resolved onto
    // the model). Presenting now would claim a camera fit for an empty scene
    // — and mark the key as presented — so the real first present later
    // wouldn't move the camera. Wait for the first meaningful scene instead.
    if (scene.nodes.length === 0 && scene.notes.length === 0) return;
    const bounds = sceneBounds(scene);
    const fit = bounds
      ? fitCamera(bounds, { width: viewportWidth, height: viewportHeight })
      : null;
    // show() writes the stage. Don't let that write resubscribe this effect.
    // A scene update for the view already on screen must not cancel a tween
    // that started because the key changed.
    untrack(() => {
      if (stage.settling && presentedKey === viewKey) return;
      const switching = presentedKey !== null && presentedKey !== viewKey;
      stage.show(scene, fit, {
        transition: switching,
        moveCamera: presentedKey === null || switching,
      });
      presentedKey = viewKey;
    });
  });

  $effect(() => () => stage.destroy());
</script>

<div
  class="relative h-full min-h-0 w-full flex-1"
  bind:clientWidth={viewportWidth}
  bind:clientHeight={viewportHeight}
>
  <svg
    width="100%"
    height="100%"
    viewBox="{stage.camera.x} {stage.camera.y} {Math.max(viewportWidth, 1) /
      stage.camera.zoom} {Math.max(viewportHeight, 1) / stage.camera.zoom}"
  >
    <DiagramCanvas
      scene={stage.shown ? stage.scene : scene}
      linkNodes={linkNodes}
      {linkLabel}
      frozen={stage.settling}
      onNodeClick={onNodeClick}
      onNodeHover={onNodeHover}
    />
  </svg>
</div>
