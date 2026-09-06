// Auto-size rhizz-project iframes to their content.
//
// The embedded /book-example route measures itself (ResizeObserver) and
// posts `{ source: "rhizz-book-example", height }` here. Small embeds shrink
// to fit and medium ones grow; only very tall content is capped (inner
// regions — code, diagnostics — scroll by themselves). Only iframes
// carrying the `rhizz-example` class participate.
(function () {
  var MIN_HEIGHT = 160;
  var MAX_HEIGHT = 1100;
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "rhizz-book-example") return;
    if (typeof data.height !== "number" || !Number.isFinite(data.height)) {
      return;
    }
    var frames = document.querySelectorAll("iframe.rhizz-example");
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      if (frame.contentWindow === event.source) {
        var next = Math.max(
          MIN_HEIGHT,
          Math.min(MAX_HEIGHT, Math.round(data.height)),
        );
        frame.style.height = next + "px";
      }
    }
  });
})();
