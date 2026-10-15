import { expect, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// One selection drives the canvas, the component list and the inspector. The
// bug: picking a component in the list highlighted it on the canvas but left
// the inspector on the previously clicked component.

async function createPlacedComponent(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(name);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
}

test("selecting a component in the list moves the inspector too", async ({
  page,
}) => {
  const id = await createNewProject(page, "E2E focus sync");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();

  await createPlacedComponent(page, "e2e-focus-alpha");

  // Creating a component selects it, and the modal nests a new component under
  // the current selection. Clear the selection so beta is a top-level sibling.
  const canvas = page.getByTestId("diagram-canvas");
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("canvas has no bounding box");
  await page.mouse.click(canvasBox.x + 5, canvasBox.y + 5);

  await createPlacedComponent(page, "e2e-focus-beta");

  // Both nodes spawn at the same point; drag beta away so alpha is clickable.
  const betaNode = canvas.getByText("e2e-focus-beta").first();
  const betaBox = await betaNode.boundingBox();
  if (!betaBox) throw new Error("beta node has no bounding box");
  const startX = betaBox.x + betaBox.width / 2;
  const startY = betaBox.y + betaBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 250, startY + 150, { steps: 10 });
  await page.mouse.up();

  const inspector = page.getByTestId("node-inspector");

  // Click alpha on the canvas: the inspector follows.
  const alphaNode = canvas.getByText("e2e-focus-alpha").first();
  const alphaBox = await alphaNode.boundingBox();
  if (!alphaBox) throw new Error("alpha node has no bounding box");
  await page.mouse.click(
    alphaBox.x + alphaBox.width / 2,
    alphaBox.y + alphaBox.height / 2,
  );
  await expect(page.getByTestId("component-source")).toContainText(
    "e2e-focus-alpha",
  );

  // Click beta in the component list: the inspector must follow.
  await page
    .getByRole("button", { name: "e2e-focus-beta", exact: true })
    .click();
  await expect(page.getByTestId("component-source")).toContainText(
    "e2e-focus-beta",
  );
  await expect(inspector).not.toContainText("e2e-focus-alpha");
});
