import { expect, type Locator, type Page, test } from "@playwright/test";

// Entities spawned by a keyboard shortcut land under the pointer, so a
// keyboard-driven workflow never has to interleave mouse placement: the
// pointer is aimed once, then every `C`/`N` drops an entity right there.

async function openDiagram(page: Page) {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("E2E spawn cursor"));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  const tourDialog = page.getByRole("alertdialog");
  await expect(tourDialog).toBeVisible();
  await tourDialog.getByRole("button", { name: "skip tour" }).click();
  await expect(tourDialog).toBeHidden();
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  const canvas = page.getByTestId("diagram-canvas");
  await expect(canvas).toBeVisible();
  return canvas;
}

// A point in the lower-left quadrant of the canvas, as screen coordinates —
// far from the viewport center, so "placed at the center" and "placed under
// the pointer" can never be confused.
async function offCenterPoint(canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  return { x: box.x + box.width * 0.25, y: box.y + box.height * 0.7 };
}

// Where an annotation's text lands for a given anchor point: the anchor is
// the first line's baseline start, i.e. the text's bottom-left corner.
// `-1` precision = a 5px budget, which covers the font's descender below
// the baseline and the glyph side bearing left of the anchor.
function expectNoteAnchor(
  textBox: { x: number; y: number; height: number },
  anchor: { x: number; y: number },
) {
  expect(textBox.x).toBeCloseTo(anchor.x, -1);
  expect(textBox.y + textBox.height).toBeCloseTo(anchor.y, -1);
}

test("N spawns an annotation under the pointer", async ({ page }) => {
  const canvas = await openDiagram(page);
  const point = await offCenterPoint(canvas);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.press("n");

  const note = canvas.getByText("New note");
  await expect(note).toBeVisible();
  const textBox = await note.boundingBox();
  if (!textBox) throw new Error("annotation text has no bounding box");
  expectNoteAnchor(textBox, point);
});

test("C spawns a component centered under the pointer", async ({ page }) => {
  const canvas = await openDiagram(page);
  const point = await offCenterPoint(canvas);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.press("c");

  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("e2e-spawned");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();

  // The node box is centered on the pointer, and snaps to the 10-unit grid
  // (on by default), so each axis may land up to half a cell off it.
  const nodeBox = await canvas.getByText("e2e-spawned").boundingBox();
  if (!nodeBox) throw new Error("created node has no bounding box");
  expect(nodeBox.x + nodeBox.width / 2).toBeCloseTo(point.x, -1);
  expect(nodeBox.y + nodeBox.height / 2).toBeCloseTo(point.y, -1);
});

test("pointer off the canvas falls back to the viewport center", async ({ page }) => {
  const canvas = await openDiagram(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Leave the canvas: with the pointer over the sidebar there is no cursor
  // to place under, so the entity lands where the user is looking instead.
  await page.mouse.move(center.x, center.y);
  await page.mouse.move(0, 0);
  await page.keyboard.press("n");

  const textBox = await canvas.getByText("New note").boundingBox();
  if (!textBox) throw new Error("annotation text has no bounding box");
  expectNoteAnchor(textBox, center);
});
