import { describe, expect, it } from "vitest";
import { viewNameFromPath } from "./persistence";

describe("Diagram Embedding URL resolution", () => {
  it("normalizes embed diagram paths", () => {
    expect(viewNameFromPath("overview.hcl")).toBe("overview");
    expect(viewNameFromPath(".rhizz/diagrams/overview.hcl")).toBe("overview");
    expect(viewNameFromPath("subfolder/cloud-path.hcl")).toBe("cloud-path");
  });

  it("handles bare diagram names cleanly", () => {
    expect(viewNameFromPath("overview")).toBe("overview");
  });
});
