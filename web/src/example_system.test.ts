import { describe, expect, it } from "vitest";
import { EXAMPLE_SYSTEM_DIAGRAMS } from "./example_system";

describe("EXAMPLE_SYSTEM_DIAGRAMS", () => {
  it("includes at least two named diagrams suitable for the viewer", () => {
    const names = Object.keys(EXAMPLE_SYSTEM_DIAGRAMS);

    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toEqual(
      expect.arrayContaining(["overview.json", "cloud-path.json"]),
    );

    for (const layout of Object.values(EXAMPLE_SYSTEM_DIAGRAMS)) {
      expect(layout.checked).toBeTypeOf("object");
      expect(layout.savedLayout).toBeTypeOf("object");
    }
  });
});
