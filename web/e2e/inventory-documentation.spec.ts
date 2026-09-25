import { expect, test } from "@playwright/test";

// Inventory → documentation tab: the "Full name" tab shows the component's
// `docs/<label>.md` (rendered Markdown) with a viewer/editor toggle, and
// saving persists to the project's VFS.
async function openInventory(page, name = "E2E inventory docs") {
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

  // A fresh definition has no docs file yet.
  await page.getByRole("button", { name: "+ Component" }).click();
  const modal = page.getByTestId("create-component-modal");
  await expect(modal).toBeVisible();
  await modal.locator("#new-comp-name").fill("e2e-docs");
  await modal.getByRole("button", { name: "Create Definition" }).click();
  await expect(modal).toBeHidden();

  await page.goto(`/projects/${id}/inventory`);
  await page.getByText("e2e-docs").first().click();
}

test("inventory writes documentation from the Full name tab", async ({ page }) => {
  await openInventory(page);
  const pane = page.getByTestId("inventory-detail-pane");
  await expect(pane).toBeVisible();

  // No docs file yet: the Full name tab offers to create it.
  const viewer = page.getByTestId("inventory-doc-viewer");
  await expect(viewer).toContainText("No documentation yet");
  await page.getByTestId("inventory-doc-edit-button").click();

  // The editor opens empty; saving renders Markdown in the viewer.
  const textarea = page.getByTestId("inventory-doc-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("");
  await textarea.fill("# E2E widget\n\nDoes **things**.");
  await page.getByTestId("inventory-doc-save-button").click();
  await expect(textarea).toBeHidden();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading", { name: "E2E widget" }))
    .toBeVisible();
  await expect(page.getByText("**things**")).toBeHidden();

  // Persisted to the VFS: still rendered after a reload.
  await page.reload();
  await page.getByText("e2e-docs").first().click();
  await expect(page.getByTestId("inventory-doc-viewer")).toBeVisible();
  await expect(
    page.getByTestId("inventory-doc-viewer").getByRole("heading", {
      name: "E2E widget",
    }),
  ).toBeVisible();

  // Edit reopens prefilled; Cancel discards without touching the viewer.
  await page.getByTestId("inventory-doc-edit-button").click();
  const textarea2 = page.getByTestId("inventory-doc-textarea");
  await expect(textarea2).toHaveValue("# E2E widget\n\nDoes **things**.");
  await textarea2.fill("discarded draft");
  await page.getByTestId("inventory-doc-cancel-button").click();
  await expect(textarea2).toBeHidden();
  await expect(
    page.getByTestId("inventory-doc-viewer").getByRole("heading", {
      name: "E2E widget",
    }),
  ).toBeVisible();
});
