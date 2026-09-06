// Auto-size rhizz-project iframes to their content.
//
// The embedded /book-example route measures itself (ResizeObserver) and
// posts `{ source: "rhizz-book-example", height }` here. Small embeds shrink
// to fit; nothing ever grows past the height attribute, so large examples
// keep their inside-iframe scrolling. Only iframes carrying the
// `rhizz-example` class participate.
(function () {
  function initialHeight(frame) {
    const raw = Number(frame.getAttribute("height") || "500");
    return Number.isFinite(raw) && raw > 0 ? raw : 500;
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "rhizz-book-example") return;
    if (typeof data.height !== "number" || !Number.isFinite(data.height)) {
      return;
    }
    const frames = document.querySelectorAll("iframe.rhizz-example");
    for (const frame of frames) {
      if (frame.contentWindow === event.source) {
        const next = Math.max(
          160,
          Math.min(initialHeight(frame), Math.round(data.height)),
        );
        frame.style.height = next + "px";
      }
    }
  });
})();
