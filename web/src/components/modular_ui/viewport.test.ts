import { afterEach, describe, expect, it } from "vitest";
import { viewportCap } from "./viewport";

afterEach(() => {
  // Bare node has no window; restore that between tests.
  Reflect.deleteProperty(globalThis, "window");
});

function stubWindow(width: number, height: number): void {
  Object.defineProperty(globalThis, "window", {
    value: { innerWidth: width, innerHeight: height },
    writable: true,
    configurable: true,
  });
}

describe("viewportCap", () => {
  it("is uncapped without a viewport (SSR, unit tests)", () => {
    expect(viewportCap(0.4, "width")).toBe(Number.POSITIVE_INFINITY);
    expect(viewportCap(0.7, "height")).toBe(Number.POSITIVE_INFINITY);
  });

  it("caps side panels to a share of the viewport width", () => {
    stubWindow(1280, 800);
    expect(viewportCap(0.4, "width")).toBe(512);
  });

  it("caps the bottom bar to a share of the viewport height", () => {
    stubWindow(1280, 800);
    expect(viewportCap(0.7, "height")).toBe(560);
  });

  it("scales with the viewport", () => {
    stubWindow(1920, 1080);
    expect(viewportCap(0.4, "width")).toBe(768);
    expect(viewportCap(0.7, "height")).toBe(756);
  });
});
