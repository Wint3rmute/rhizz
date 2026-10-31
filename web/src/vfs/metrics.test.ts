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
  it.each([12345, 0])("records blob size %i as a byte-unit gauge", (size) => {
    mocks.gauge.mockClear();
    reportVfsSizeBytes(size);
    expect(mocks.gauge).toHaveBeenCalledWith(VFS_SIZE_METRIC, size, {
      unit: "byte",
    });
  });
});
