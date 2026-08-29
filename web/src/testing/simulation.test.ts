import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ComponentVisualSnapshot,
  WorkspaceHarness,
} from "./WorkspaceHarness";

const FIXTURES = ["empty", "drone", "software-house", "apollo-11"] as const;
type Fixture = (typeof FIXTURES)[number];

const COLORS = [undefined, "primary", "success", "warning"] as const;
const BORDERS = [undefined, "solid", "dashed", "dotted"] as const;
const FONTS = [undefined, "bold", "italic", "underline"] as const;

interface GeneratedEdit {
  kind: "visual" | "move" | "diagram";
  componentSelector: number;
  colorSelector: number;
  borderSelector: number;
  fontSelector: number;
  x: number;
  y: number;
  diagramSelector: number;
}

async function createFixture(fixture: Fixture): Promise<WorkspaceHarness> {
  return fixture === "empty"
    ? await WorkspaceHarness.empty()
    : await WorkspaceHarness.fromExample(fixture);
}

function expectUnrelatedVisualsUnchanged(
  before: Record<string, ComponentVisualSnapshot>,
  after: Record<string, ComponentVisualSnapshot>,
  changedKey: string,
): void {
  for (const [key, visuals] of Object.entries(before)) {
    if (key === changedKey) continue;
    expect(after[key], `mutation-isolation: unexpected change to ${key}`)
      .toEqual(
        visuals,
      );
  }
}

const editArbitrary = fc.record({
  kind: fc.constantFrom("visual", "move", "diagram"),
  componentSelector: fc.nat(),
  colorSelector: fc.nat(),
  borderSelector: fc.nat(),
  fontSelector: fc.nat(),
  x: fc.integer({ min: -2_000, max: 2_000 }),
  y: fc.integer({ min: -2_000, max: 2_000 }),
  diagramSelector: fc.nat(),
});

describe("deterministic workspace simulation", () => {
  it(
    "preserves invariants across 500 generated multi-step mutation sequences",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...FIXTURES),
          fc.array(editArbitrary, { minLength: 2, maxLength: 6 }),
          async (fixture, edits) => {
            const workspace = await createFixture(fixture);
            workspace.assertInvariants();

            const editableKeys = await workspace.editableComponentKeys();
            const allKeys = workspace.componentKeys;

            for (const edit of edits as GeneratedEdit[]) {
              if (edit.kind === "diagram") {
                const selectionBefore = workspace.selectedComponentKey;
                await workspace.dispatch({
                  type: "add-diagram-view",
                  name: `generated-${String(edit.diagramSelector % 8)}`,
                });
                workspace.assertInvariants();
                expect(workspace.selectedComponentKey).toBe(selectionBefore);
                continue;
              }

              const candidates = edit.kind === "visual"
                ? editableKeys
                : allKeys;
              if (candidates.length === 0) continue;
              const key =
                candidates[edit.componentSelector % candidates.length];
              if (!key) {
                throw new Error(
                  "generated component key did not resolve",
                );
              }

              if (edit.kind === "move") {
                const visualsBefore = workspace.componentVisuals();
                const selectionBefore = workspace.selectedComponentKey;
                await workspace.dispatch({
                  type: "move-node",
                  component: key,
                  x: edit.x,
                  y: edit.y,
                });
                workspace.assertInvariants();
                expect(workspace.layoutPosition(key)).toEqual({
                  x: edit.x,
                  y: edit.y,
                });
                expect(workspace.selectedComponentKey).toBe(selectionBefore);
                expect(workspace.componentVisuals()).toEqual(visualsBefore);
                continue;
              }

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
    },
    60_000,
  );
});
