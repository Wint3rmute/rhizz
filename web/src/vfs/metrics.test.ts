import { describe, expect, it, vi } from "vitest";

// No interface for the mock shape: annotating it would erase the `Mock`
// types vi.fn() gives each function, and `.mockClear()` below would stop
// resolving.
const mocks = vi.hoisted(() => ({
  gauge: vi.fn(),
}));

vi.mock("@sentry/sveltekit", () => ({
  metrics: { gauge: mocks.gauge },
}));

import { reportVfsSizeBytes, VFS_SIZE_METRIC } from "./metrics";

describe("reportVfsSizeBytes", () => {
  it("records the blob size as a byte-unit gauge", () => {
    reportVfsSizeBytes(12345);
    expect(mocks.gauge).toHaveBeenCalledWith(VFS_SIZE_METRIC, 12345, {
      unit: "byte",
    });
  });

  it("reports zero, not nothing, for an empty blob", () => {
    mocks.gauge.mockClear();
    reportVfsSizeBytes(0);
    expect(mocks.gauge).toHaveBeenCalledWith(VFS_SIZE_METRIC, 0, {
      unit: "byte",
    });
  });
});
