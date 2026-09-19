import { expect, test } from "@playwright/test";

// Delete on the Diagrams page removes the node from the current view only:
// the canvas hides it, but the model keeps the component — the reusable
// definition row survives, the Editor still shows its HCL, and Ctrl+Z
// undoes the removal.
async function openDiagram(page, name = "E2E delete view") {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept(name));
  await create.click();
  // Fresh projects auto-open the guided tour, which routes to the
  // overview — either landing proves creation. Silence the tour before
  // continuing: its backdrop would blanket the canvas under test.
  await expect(page).toHaveURL(/\/projects\/.+\/(editor|overview)/);
  const tourDialog = page.getByRole("alertdialog");
  await expect(tourDialog).toBeVisible();
  await tourDialog.getByRole("button", { name: "skip tour" }).click();
  await expect(tourDialog).toBeHidden();
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/projects/${id}/diagrams`);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  if (!id) throw new Error("project id missing from URL");
  return id;
}

async function createComponent(page, label: string) {
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill(label);
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();
  const canvas = page.getByTestId("diagram-canvas");
  await expect(canvas.getByText(label).first()).toBeVisible();
}

test("delete removes the node from the view but keeps it in the model", async ({ page }) => {
  const id = await openDiagram(page);
  await createComponent(page, "e2e-vanish");

  const canvas = page.getByTestId("diagram-canvas");

  // Select the node explicitly (creation auto-selects, but the click also
  // proves selection), then focus the canvas: node mousedown calls
  // preventDefault, so clicking never moves focus there on its own, yet the
  // Delete shortcut requires canvas focus.
  const node = canvas.getByText("e2e-vanish").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("node-inspector")).toBeVisible();
  await canvas.focus();

  await page.keyboard.press("Delete");
  await expect(canvas.getByText("e2e-vanish").first()).toBeHidden();

  // The model keeps the component: its reusable-definition row survives.
  await expect(page.locator('li[title="e2e-vanish"]')).toBeVisible();

  // Undo restores the node on canvas, redo removes it from the view again.
  await page.keyboard.press("Control+z");
  await expect(canvas.getByText("e2e-vanish").first()).toBeVisible();
  await page.keyboard.press("Control+y");
  await expect(canvas.getByText("e2e-vanish").first()).toBeHidden();

  // The model keeps the component: the Editor still shows its instance
  // block. (A whole-model delete removes the instance and leaves only the
  // bare `component` definition, so matching the bare label is not enough.)
  await page.goto(`/projects/${id}/editor`);
  const editor = page.locator(".monaco-editor");
  await expect(editor).toBeVisible();
  await expect(editor.getByText('instance "e2e-vanish"').first())
    .toBeVisible();
});
