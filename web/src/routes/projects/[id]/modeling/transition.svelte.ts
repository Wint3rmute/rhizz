// Plays a scene/camera tween. The page calls `show` and forgets the easing.
// `show` is called from effects that must not subscribe to the stage state it
// writes, or opening a diagram retriggers the effect until Svelte gives up.
import { untrack } from "svelte";
import {
  advance,
  type Camera,
  emptyScene,
  frameAt,
  prefersReducedMotion,
  type Tween,
} from "./blend";
import type { DiagramScene } from "./scene";

export function createDiagramTransition() {
  let scene = $state<DiagramScene>(emptyScene());
  let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 });
  let settling = $state(false);
  let shown = $state(false);
  let tween: Tween | null = null;
  let raf = 0;
  let onCamera: ((camera: Camera) => void) | undefined;

  function stop(): void {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  }

  function publish(
    nextScene: DiagramScene,
    nextCamera: Camera,
    pushCamera: boolean,
  ): void {
    scene = nextScene;
    camera = nextCamera;
    if (pushCamera) onCamera?.(nextCamera);
  }

  function tick(now: number): void {
    if (!tween) return;
    const frame = frameAt(tween, now);
    publish(frame.scene, frame.camera, tween.moveCamera);
    if (frame.done) {
      tween = null;
      settling = false;
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function show(
    next: DiagramScene,
    nextCamera: Camera | null,
    opts: { transition: boolean; moveCamera: boolean },
    applyCamera?: (nextCamera: Camera) => void,
  ): void {
    onCamera = opts.moveCamera ? applyCamera : undefined;
    const now = typeof performance === "undefined" ? 0 : performance.now();
    const displayed = untrack(() =>
      tween ? frameAt(tween, now) : { scene, camera }
    );
    const result = advance(
      displayed,
      { scene: next, camera: nextCamera },
      {
        transition: opts.transition,
        moveCamera: opts.moveCamera,
        reducedMotion: prefersReducedMotion(),
        now,
        tween,
      },
    );
    tween = result.tween;
    settling = result.settling;
    shown = true;
    publish(result.scene, result.camera, opts.moveCamera);
    stop();
    if (result.settling) raf = requestAnimationFrame(tick);
  }

  return {
    get scene() {
      return scene;
    },
    get camera() {
      return camera;
    },
    get settling() {
      return settling;
    },
    get shown() {
      return shown;
    },
    show,
    destroy: stop,
  };
}
