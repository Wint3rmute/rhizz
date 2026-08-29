import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ComponentVisualSnapshot,
  type ExampleId,
  WorkspaceHarness,
} from "./WorkspaceHarness";

const FIXTURES = ["empty", "drone", "software-house", "apollo-11"] as const;
type Fixture = (typeof FIXTURES)[number];

const COLORS = [undefined, "primary", "success", "warning"] as const;
const BORDERS = [undefined, "solid", "dashed", "dotted"] as const;
const FONTS = [undefined, "bold", "italic", "underline"] as const;

interface GeneratedEdit {
  componentSelector: number;
  colorSelector: number;
  borderSelector: number;
  fontSelector: number;
}

async function createFixture(fixture: Fixture): Promise<WorkspaceHarness> {
  return fixture === "empty"
    ? await WorkspaceHarness.empty()
    : await WorkspaceHarness.fromExample(fixture as ExampleId);
}

function expectUnrelatedVisualsUnchanged(
  before: Record<string, ComponentVisualSnapshot>,
  after: Record<string, ComponentVisualSnapshot>,
  changedKey: string,
): void {
  for (const [key, visuals] of Object.entries(before)) {
    if (key === changedKey) continue;
    expect(after[key], `mutation-isolation: unexpected change to ${key}`).toEqual(
      visuals,
    );
  }
}

const editArbitrary = fc.record({
  componentSelector: fc.nat(),
  colorSelector: fc.nat(),
  borderSelector: fc.nat(),
  fontSelector: fc.nat(),
});

describe("deterministic workspace simulation", () => {
  it("preserves invariants across 500 generated multi-step mutation sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...FIXTURES),
        fc.array(editArbitrary, { minLength: 2, maxLength: 6 }),
        async (fixture, edits) => {
          const workspace = await createFixture(fixture);
          workspace.assertInvariants();

          const editableKeys = await workspace.editableComponentKeys();
          if (editableKeys.length === 0) return;

          for (const edit of edits as GeneratedEdit[]) {
            const key = editableKeys[edit.componentSelector % editableKeys.length];
            if (!key) throw new Error("generated component key did not resolve");
            const before = workspace.componentVisuals();

            await workspace.dispatch({
              type: "set-node-visuals",
              component: key,
              color: COLORS[edit.colorSelector % COLORS.length],
              border: BORDERS[edit.borderSelector % BORDERS.length],
              font: FONTS[edit.fontSelector % FONTS.length],
            });

            workspace.assertInvariants();
            expect(workspace.selectedComponentKey).toBe(key);
            expectUnrelatedVisualsUnchanged(
              before,
              workspace.componentVisuals(),
              key,
            );
          }
        },
      ),
      {
        numRuns: 500,
        endOnFailure: true,
      },
    );
  }, 60_000);
});
