// Reports the embed's content height to the parent window so embedding
// pages (book iframes) can shrink small examples to fit. Uses offsetHeight
// — the rendered box, not scrollable overflow — so capped regions (code,
// diagnostics) keep their inside scrolling instead of growing the frame.
// Skipped outside an iframe; safe to call anywhere (module has no DOM
// access at import time).
export function postExampleHeight(element: HTMLElement | null): void {
  if (element === null || typeof window === "undefined") return;
  if (window.parent === window) return;
  window.parent.postMessage(
    { source: "rhizz-book-example", height: element.offsetHeight },
    "*",
  );
}
