import { expect, test } from "@playwright/test";
import {
  createNewProject,
  replaceModel,
  storedFiles,
  viewFile,
} from "./helpers";

// Placing a parent with already-placed descendants surrounds them (full
// descendant union) instead of landing at a default 100x100 and squishing
// them via reclampChildren.
const MODEL = `component "leaf" {
  leaf = true
}
component "mid" {
  instance "kid" { source = "leaf" }
}
component "top" {
  instance "middle" { source = "mid" }
  instance "sibling" { source = "leaf" }
}
system "app" {
  instance "top" { source = "top" }
}
`;

test("placing a parent surrounds already-placed descendants", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E parent surround");
  await replaceModel(page, MODEL);
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  const tree = page.getByTestId("modeling-pane-right");
  const canvas = page.getByTestId("diagram-canvas");

  async function place(name: string): Promise<void> {
    const button = tree.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const item = button.locator("xpath=parent::*");
    await item.getByRole("checkbox").check();
  }

  async function select(name: string): Promise<void> {
    await tree.getByRole("button", { name, exact: true }).click();
  }

  await tree.getByRole("button", { name: "Expand all" }).click();
  // Grandchild (via middle) + direct child, leaving middle + top unplaced:
  // proves the full descendant union, not just direct children.
  await place("kid");
  await place("sibling");

  // Spread them apart so the surround box is meaningfully larger than a
  // default 100x100 (fresh placements all land at the viewport center).
  await select("kid");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowLeft");
  await select("sibling");
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");

  const kidBefore = await canvas
    .getByText("kid", { exact: true })
    .first()
    .boundingBox();
  const siblingBefore = await canvas
    .getByText("sibling", { exact: true })
    .first()
    .boundingBox();
  if (!kidBefore || !siblingBefore) throw new Error("children have no boxes");
  // Sanity: they no longer overlap after the nudge.
  expect(kidBefore.x + kidBefore.width).toBeLessThan(siblingBefore.x);

  // Placing the parent must wrap both descendants with padding. Assert on
  // the persisted world boxes (views/*.hcl), not screen text boxes: the
  // parent's label is centered, so its text box never contains the children.
  await place("top");

  interface WorldBox {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  function parseViewBoxes(hcl: string): Record<string, WorldBox> {
    const boxes: Record<string, WorldBox> = {};
    const re =
      /node "([^"]+)" \{[\s\S]*?x\s*=\s*(-?[0-9.]+)[\s\S]*?y\s*=\s*(-?[0-9.]+)[\s\S]*?width\s*=\s*(-?[0-9.]+)[\s\S]*?height\s*=\s*(-?[0-9.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(hcl)) !== null) {
      boxes[m[1]!] = {
        x: Number(m[2]),
        y: Number(m[3]),
        width: Number(m[4]),
        height: Number(m[5]),
      };
    }
    return boxes;
  }

  const viewText = async (): Promise<string> =>
    viewFile(await storedFiles(page));
  let boxes: Record<string, WorldBox> = {};
  await expect
    .poll(
      async () => {
        boxes = parseViewBoxes(await viewText());
        return boxes["app/top"];
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();

  const top = boxes["app/top"]!;
  const kid = boxes["app/top/middle/kid"]!;
  const sibling = boxes["app/top/sibling"]!;
  expect(kid).toBeTruthy();
  expect(sibling).toBeTruthy();
  // Children were nudged apart, so the surround is meaningfully larger
  // than the 100x100 default.
  expect(top.width).toBeGreaterThan(200);
  for (const inner of [kid, sibling]) {
    expect(top.x).toBeLessThan(inner.x);
    expect(top.y).toBeLessThan(inner.y);
    expect(top.x + top.width).toBeGreaterThan(inner.x + inner.width);
    expect(top.y + top.height).toBeGreaterThan(inner.y + inner.height);
  }
});
