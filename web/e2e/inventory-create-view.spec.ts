import { expect, test } from "@playwright/test";

// Inventory → "Create a view for this component": a definition without a
// same-named view gets a button that creates views/<label>.hcl (bound to
// the instantiating system) and opens Modeling with that very view.
async function openModeling(page, name = "E2E inventory view") {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept(name));
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

test("inventory creates and opens a component-specific view", async ({ page }) => {
  const id = await openModeling(page);

  // A fresh definition has no same-named view file.
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("e2e-widget");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();

  await page.goto(`/projects/${id}/inventory`);
  await page.getByText("e2e-widget").first().click();
  const emptyState = page.getByTestId("inventory-empty-diagram");
  await expect(emptyState).toBeVisible();
  await emptyState
    .getByRole("button", { name: "Create a view for this component" })
    .click();

  // Lands in Modeling with the new view selected via ?diagram=.
  await expect(page).toHaveURL(/\/modeling\?diagram=views%2Fe2e-widget\.hcl/);
  await expect(page.getByTestId("diagram-toolbar")).toBeVisible();
  await expect(page.getByTestId("diagram-canvas")).toBeVisible();
  await expect(page.getByTestId("diagram-system-label")).toContainText(
    "system: main",
  );

  // Back in Inventory the empty state is gone: the view loads as a preview.
  await page.goto(`/projects/${id}/inventory`);
  await page.getByText("e2e-widget").first().click();
  await expect(page.getByTestId("inventory-empty-diagram")).toBeHidden();
});
