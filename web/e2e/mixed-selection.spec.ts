import { expect, type Locator, type Page, test } from "@playwright/test";

// A component and a note can be selected together (shift-click each), and
// the canvas operations that act on "the selection" then cover both: the
// arrow keys move them together, Delete removes both in one undo point.

async function openDiagram(page: Page) {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("E2E mixed selection"));
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

type Rect = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

function centerOf(box: Rect) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickAt(page: Page, locator: Locator) {
  const point = centerOf(await boxOf(locator));
  await page.mouse.click(point.x, point.y);
}

// `page.mouse.click` has no `modifiers` option (only the high-level
// locator/page click APIs do), so shift-click holds the key across the click.
async function shiftClickAt(page: Page, locator: Locator) {
  const point = centerOf(await boxOf(locator));
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}

// A component on the canvas plus a note at a clearly different spot, both
// already selected. A fresh project puts the node on the viewport center, so
// the note is spawned with the pointer over empty canvas well away from it.
async function selectMixed(page: Page) {
  const canvas = await openDiagram(page);
  // Snapping off: a note spawned under the pointer starts off-grid, so with
  // snapping on the first nudge would also pull it onto the grid. Off, one
  // step is a plain 10 units on both kinds.
  await page.getByRole("button", { name: /snap to grid/i }).click();
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await modal.locator("#new-comp-name").fill("e2e-mixed");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  const node = canvas.getByText("e2e-mixed").first();
  await expect(node).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
  await page.keyboard.press("n");
  const note = canvas.getByText("New note").first();
  await expect(note).toBeVisible();

  // A note is selected as it spawns — and selecting a note drops a selected
  // component, so the mixed selection is built the way a user builds it: a
  // plain click on the component, then shift-click to extend it to the note.
  await clickAt(page, node);
  await shiftClickAt(page, note);
  return { canvas, node, note };
}

test("a component and a note can be selected together, and move together", async ({ page }) => {
  const { node, note } = await selectMixed(page);
  const nodeBefore = await boxOf(node);
  const noteBefore = await boxOf(note);

  await page.keyboard.press("ArrowRight");

  expect((await boxOf(node)).x - nodeBefore.x).toBeCloseTo(10, 0);
  expect((await boxOf(note)).x - noteBefore.x).toBeCloseTo(10, 0);
});

test("Delete removes the whole mixed selection in one undo point", async ({ page }) => {
  const { node, note } = await selectMixed(page);

  await page.keyboard.press("Delete");

  await expect(node).toBeHidden();
  await expect(note).toBeHidden();

  // One gesture, one undo: both come back together.
  await page.keyboard.press("Control+z");
  await expect(node).toBeVisible();
  await expect(note).toBeVisible();
});

test("right-clicking a selected component keeps the note in the selection", async ({ page }) => {
  const { canvas, node, note } = await selectMixed(page);

  await page.mouse.click(
    centerOf(await boxOf(node)).x,
    centerOf(await boxOf(note)).y,
    {
      button: "right",
    },
  );
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("context-menu")).toBeHidden();

  // The whole selection survived the menu: both still move.
  const nodeBefore = await boxOf(node);
  const noteBefore = await boxOf(note);
  await page.keyboard.press("ArrowRight");

  expect((await boxOf(node)).x - nodeBefore.x).toBeCloseTo(10, 0);
  expect((await boxOf(note)).x - noteBefore.x).toBeCloseTo(10, 0);
  await expect(canvas.getByText("e2e-mixed").first()).toBeVisible();
});
