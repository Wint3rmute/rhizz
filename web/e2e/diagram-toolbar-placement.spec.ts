import { expect, test } from "@playwright/test";
import { skipTourIfPresent } from "./helpers";

// The diagram toolbar is a floating bar over the canvas, anchored to the
// top edge — it used to be anchored to the bottom, where it sat a screen
// away from the model it acts on. The anchoring is one positioning class
// and nothing else in the app depends on it, so without this the bar
// would drift back to the bottom the next time anyone touched its styling.
test("the diagram toolbar is pinned to the top of the canvas", async ({ page }) => {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept("E2E toolbar placement"));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/projects/${id}/modeling`);

  const toolbar = page.getByTestId("diagram-toolbar");
  const canvas = page.getByTestId("diagram-canvas");
  await expect(toolbar).toBeVisible();
  await expect(canvas).toBeVisible();

  const toolbarBox = await toolbar.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!toolbarBox || !canvasBox) throw new Error("missing bounding box");

  // Top-anchored, keeping the inset the bottom anchor had: `top-2` and
  // `bottom-2` are both 0.5rem, so the bar sits 8px off the edge. A few px
  // of slack absorbs the canvas element's own edge.
  expect(toolbarBox.y).toBeGreaterThan(canvasBox.y);
  expect(toolbarBox.y - canvasBox.y).toBeLessThanOrEqual(16);

  // Still horizontally centred — the other half of the anchor, which the
  // move to the top must leave alone.
  const toolbarCentre = toolbarBox.x + toolbarBox.width / 2;
  const canvasCentre = canvasBox.x + canvasBox.width / 2;
  expect(Math.abs(toolbarCentre - canvasCentre)).toBeLessThanOrEqual(2);
});
