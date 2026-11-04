import { describe, expect, it } from "vitest";
import { canvasCursor } from "./canvasCursor";

describe("canvasCursor", () => {
  it("shows the live gesture while editable", () => {
    const base = { autoLayoutRunning: false, readonly: false };
    expect(canvasCursor({ ...base, interactionType: "idle" })).toBe("grab");
    expect(canvasCursor({ ...base, interactionType: "dragging" })).toBe(
      "grabbing",
    );
    expect(canvasCursor({ ...base, interactionType: "resizing" })).toBe(
      "grabbing",
    );
    expect(canvasCursor({ ...base, interactionType: "panning" })).toBe(
      "grabbing",
    );
    expect(canvasCursor({ ...base, interactionType: "marquee" })).toBe(
      "crosshair",
    );
    expect(canvasCursor({ ...base, interactionType: "connecting" })).toBe(
      "grab",
    );
    expect(canvasCursor({ ...base, interactionType: "port-dragging" })).toBe(
      "grab",
    );
  });

  it("freezes to not-allowed when read-only, except while panning", () => {
    const base = { autoLayoutRunning: false, readonly: true };
    expect(canvasCursor({ ...base, interactionType: "idle" })).toBe(
      "not-allowed",
    );
    expect(canvasCursor({ ...base, interactionType: "marquee" })).toBe(
      "not-allowed",
    );
    expect(canvasCursor({ ...base, interactionType: "dragging" })).toBe(
      "not-allowed",
    );
    // Panning is navigation, not an edit, so it keeps its affordance.
    expect(canvasCursor({ ...base, interactionType: "panning" })).toBe(
      "grabbing",
    );
  });

  it("prefers the auto-layout busy state over everything", () => {
    expect(
      canvasCursor({
        autoLayoutRunning: true,
        readonly: true,
        interactionType: "panning",
      }),
    ).toBe("wait");
    expect(
      canvasCursor({
        autoLayoutRunning: true,
        readonly: false,
        interactionType: "idle",
      }),
    ).toBe("wait");
  });
});
