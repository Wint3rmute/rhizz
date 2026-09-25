import { expect, test } from "@playwright/test";

// Right-click context menu on the Modeling canvas: per-target rows with
// shortcut hints, actions reusing the existing handlers.
async function openDiagram(page, name = "E2E context menu") {
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
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
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

test("component right-click shows menu; Hide removes from view, keeps model", async ({ page }) => {
  await openDiagram(page);
  await createComponent(page, "e2e-ctx");

  const canvas = page.getByTestId("diagram-canvas");
  const node = canvas.getByText("e2e-ctx").first();
  const box = await node.boundingBox();
  if (!box) throw new Error("created node has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: "right",
  });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /hide from this view/i }))
    .toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /jump to documentation/i }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: /jump to detailed view/i }),
  ).toBeVisible();
  await expect(menu.locator("kbd", { hasText: "H" })).toBeVisible();

  await menu.getByRole("menuitem", { name: /hide from this view/i }).click();
  await expect(menu).toBeHidden();
  await expect(canvas.getByText("e2e-ctx").first()).toBeHidden();

  // View-only removal: the reusable-definition row survives.
  await expect(page.locator('li[title="e2e-ctx"]')).toBeVisible();

  // Undo restores the node on canvas.
  await page.getByTestId("diagram-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(canvas.getByText("e2e-ctx").first()).toBeVisible();
});

test("empty canvas right-click shows canvas menu with shortcuts", async ({ page }) => {
  await openDiagram(page);
  const canvas = page.getByTestId("diagram-canvas");
  await canvas.click({ button: "right", position: { x: 30, y: 30 } });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /new component/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /new annotation/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /zoom to fill/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /reset view/i }))
    .toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /toggle grid/i }))
    .toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});
