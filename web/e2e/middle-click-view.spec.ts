import { expect, type Locator, type Page, test } from "@playwright/test";

// The middle mouse button over a node is the pointer's `V`: it opens that
// component's detail view, creating one when the component has none — from the
// node's box, from the dots on its border, and only while it has no view yet.
// Panning keeps the middle button on *empty* canvas (Space + left-drag still
// pans from anywhere, including over a node), which the last test pins as the
// regression guard for that split.
//
// The whole feature lives in these e2e tests and no Storybook story: a middle
// click has no picture to compare, so a screenshot would only ever show a
// canvas that looks the same whether the gesture worked or not.

async function openDiagram(page: Page, name: string) {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept(name));
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
  return { id, canvas };
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

// A node's label sits in the middle of its box, so the label's rect tracks the
// box's position exactly. The label itself is `pointer-events: none` (the
// surrounding box is the hit target), so this measures a point and clicks it
// rather than using a locator click, which Playwright rejects as intercepted.
async function middleClickNode(page: Page, canvas: Locator, label: string) {
  const box = await canvas.getByText(label).first().boundingBox();
  if (!box) throw new Error(`${label} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "middle",
  });
}

/** The sidebar row of the view the canvas is showing. */
function viewRow(page: Page, path: string): Locator {
  const tree = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Diagrams" }),
  });
  return tree.getByRole("button", { name: path, exact: true });
}

test("middle-clicking a node creates its detail view, then jumps to it", async ({ page }) => {
  const { id, canvas } = await openDiagram(page, "E2E middle click view");
  await createComponent(page, "e2e-middle");

  await middleClickNode(page, canvas, "e2e-middle");

  // No view of this component existed, so the gesture made one, opened it and
  // put the component on it — exactly what `V` and the context-menu row do.
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-middle.hcl`,
  );
  await expect(canvas.getByText("e2e-middle").first()).toBeVisible();
  await expect(viewRow(page, "e2e-middle.hcl")).toHaveAttribute(
    "aria-current",
    "true",
  );

  // Back to the overview, where the component now has a view: the same gesture
  // now finds it and jumps there rather than creating a second one.
  await viewRow(page, "main.hcl").click();
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await middleClickNode(page, canvas, "e2e-middle");

  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-middle.hcl`,
  );
  await expect(canvas.getByText("e2e-middle").first()).toBeVisible();
});

test("middle-clicking a node's border dot opens that node's detail view", async ({ page }) => {
  const { id, canvas } = await openDiagram(page, "E2E middle click port");
  await createComponent(page, "e2e-port");

  // The dots on a node's border (its directional connection handles, and its
  // ports where it has any) have their own mousedown handler, which used to
  // start drawing a connection from any button. They sit exactly where the
  // pointer lands on a node, so middle click has to reach the node *through*
  // them — otherwise the gesture has a hole in the most obvious place.
  const dot = canvas.locator('[data-testid="diagram-side-handle"] circle')
    .first();
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  if (!box) throw new Error("border dot has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "middle",
  });

  await expect(page).toHaveURL(`/projects/${id}/modeling/e2e-port.hcl`);
});

test("middle-drag on empty canvas still pans, and navigates nowhere", async ({ page }) => {
  const { id, canvas } = await openDiagram(page, "E2E middle click pan");
  await createComponent(page, "e2e-pan");

  // Nothing is under the cursor down here: the created node sits at the
  // viewport center and the floating toolbar is anchored to the top edge.
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error("canvas has no bounding box");
  const from = { x: canvasBox.x + 30, y: canvasBox.y + canvasBox.height - 30 };
  const label = canvas.getByText("e2e-pan").first();
  const before = await label.boundingBox();
  if (!before) throw new Error("created node has no bounding box");

  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + 120, from.y, { steps: 5 });
  await page.mouse.up({ button: "middle" });

  // Panning takes the world with the pointer, so the node's screen position
  // shifts by the drag…
  const after = await label.boundingBox();
  if (!after) throw new Error("created node has no bounding box");
  expect(after.x - before.x).toBeCloseTo(120, 0);
  // …and the middle button never became a navigation gesture on empty canvas.
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);
  await expect(viewRow(page, "main.hcl")).toHaveAttribute(
    "aria-current",
    "true",
  );
});
