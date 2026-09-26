import { expect, type Locator, type Page, test } from "@playwright/test";

// Arrow keys nudge the selection on the Modeling canvas: one step per press,
// rigidly across a multi-selection, one undo point per press — and never
// while the user is typing in the inspector.

async function openDiagram(page: Page) {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("E2E arrow nudge"));
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

async function createComponent(page: Page, label: string) {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  const canvas = page.getByTestId("diagram-canvas");
  await expect(canvas.getByText(label).first()).toBeVisible();
}

type Rect = { x: number; y: number; width: number; height: number };

// A node's label sits in the middle of its box, so the label's rect tracks
// the box's position exactly, on both axes — no need to read the transform.
async function boxOf(locator: Locator): Promise<Rect> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box");
  return box;
}

function centerOf(box: Rect) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Clicks a node label / note. Their text is `pointer-events: none` (the
// surrounding box is the hit target), so a locator click would be rejected
// as "intercepted" — click the measured point instead.
async function clickBox(page: Page, box: Rect) {
  const point = centerOf(box);
  await page.mouse.click(point.x, point.y);
}

// Same, with Shift held to extend the selection. `page.mouse.click` has no
// `modifiers` option (only the high-level locator/page click APIs do), so the
// key is held across the raw click.
async function shiftClickBox(page: Page, box: Rect) {
  const point = centerOf(box);
  await page.keyboard.down("Shift");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Shift");
}

test("arrow keys move the selected component one step per press", async ({ page }) => {
  const canvas = await openDiagram(page);
  await createComponent(page, "e2e-nudge");

  const label = canvas.getByText("e2e-nudge").first();
  await clickBox(page, await boxOf(label));
  const start = await boxOf(label);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");

  const moved = await boxOf(label);
  // The default step is the 10-unit snap grid: two presses right, one down.
  expect(moved.x - start.x).toBeCloseTo(20, 0);
  expect(moved.y - start.y).toBeCloseTo(10, 0);
  expect(moved.width).toBeCloseTo(start.width, 0);
});

test("arrow keys move a multi-component selection rigidly", async ({ page }) => {
  const canvas = await openDiagram(page);
  await createComponent(page, "e2e-first");
  // Creating while a node is selected would nest the new one inside it, and a
  // child's moves are clamped to its parent — deselect first so the two are
  // siblings, then create the second.
  await canvas.click({ position: { x: 10, y: 10 } });
  await createComponent(page, "e2e-second");

  // Both land on the viewport center, stacked. Drag the freshly created one
  // (on top, still selected) aside — the two labels have to be distinct
  // points for "rigidly" to mean anything.
  const stacked = await boxOf(canvas.getByText("e2e-second").first());
  const from = centerOf(stacked);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 150, from.y, { steps: 5 });
  await page.mouse.up();

  const first = await boxOf(canvas.getByText("e2e-first").first());
  const second = await boxOf(canvas.getByText("e2e-second").first());

  // Click the first, shift-click the second into the same selection.
  await clickBox(page, first);
  await shiftClickBox(page, second);
  // Sanity: the pair really is one two-node selection now.
  await expect(page.getByText("2 components selected.")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");

  const firstMoved = await boxOf(canvas.getByText("e2e-first").first());
  const secondMoved = await boxOf(canvas.getByText("e2e-second").first());
  expect(firstMoved.x - first.x).toBeCloseTo(10, 0);
  expect(firstMoved.y - first.y).toBeCloseTo(-10, 0);
  expect(secondMoved.x - second.x).toBeCloseTo(10, 0);
  expect(secondMoved.y - second.y).toBeCloseTo(-10, 0);
  // Rigid: the offset between the two nodes is unchanged.
  expect(
    (secondMoved.x - firstMoved.x) - (second.x - first.x),
  ).toBeCloseTo(0, 0);
  expect(
    (secondMoved.y - firstMoved.y) - (second.y - first.y),
  ).toBeCloseTo(0, 0);
});

test("every arrow press is its own undo point", async ({ page }) => {
  const canvas = await openDiagram(page);
  await createComponent(page, "e2e-undo");
  const label = canvas.getByText("e2e-undo").first();
  await clickBox(page, await boxOf(label));
  const start = await boxOf(label);

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect((await boxOf(label)).x - start.x).toBeCloseTo(20, 0);

  // One press is one discrete gesture, so each needs its own undo — like a
  // drag, which records one point per gesture rather than per frame.
  await page.keyboard.press("Control+z");
  expect((await boxOf(label)).x - start.x).toBeCloseTo(10, 0);
  await page.keyboard.press("Control+z");
  expect((await boxOf(label)).x - start.x).toBeCloseTo(0, 0);
});

test("arrow keys move a selected note", async ({ page }) => {
  const canvas = await openDiagram(page);
  // Snapping off: a note spawned at the viewport center starts off-grid, and
  // with snapping on the first press would also pull it onto the grid. Off,
  // the step is a plain 10 units — the documented default interval.
  await page.getByRole("button", { name: /snap to grid/i }).click();
  await page.keyboard.press("n");

  // `N` focuses the note's editor; click the note so the canvas (not a text
  // field) has focus, the way a mouse user would before nudging.
  const note = canvas.getByText("New note").first();
  const start = await boxOf(note);
  await clickBox(page, start);

  await page.keyboard.press("ArrowRight");

  const moved = await boxOf(note);
  expect(moved.x - start.x).toBeCloseTo(10, 0);
  expect(moved.y - start.y).toBeCloseTo(0, 0);
});

test("arrow keys do not move anything while typing in the inspector", async ({ page }) => {
  const canvas = await openDiagram(page);
  await createComponent(page, "e2e-typing");
  const label = canvas.getByText("e2e-typing").first();
  await clickBox(page, await boxOf(label));
  const start = await boxOf(label);

  // Focus (without editing) the inspector's name field: the arrows belong to
  // the text caret there, not to the canvas.
  await page.locator("#comp-name-input").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");

  const after = await boxOf(label);
  expect(after.x - start.x).toBeCloseTo(0, 0);
  expect(after.y - start.y).toBeCloseTo(0, 0);
});
