import { expect, test } from "@playwright/test";

// Inventory → documentation tab: the "Full name" tab shows the component's
// `docs/<label>.md` (rendered Markdown) with a viewer/editor toggle, and
// saving persists to the project's VFS.
//
// Editing happens in the app's Monaco editor, so this drives Monaco rather than
// a textarea: no form value to read, content read off the rendered lines, and
// typing through the keyboard into the focused editor.
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

/** The doc editor: its Monaco host, and the rendered lines inside it. */
function docEditor(page) {
  const host = page.getByTestId("inventory-doc-editor").locator(
    ".monaco-editor",
  );
  return {
    host,
    lines: host.locator(".view-lines"),
    // The element that actually takes keystrokes, by the aria label Monaco
    // gives its input (the default of `ariaLabel`). Not `textarea`: this
    // version also keeps a hidden IME composition textarea that is readonly and
    // never focused.
    input: host.locator('[aria-label="Editor content"]'),
  };
}

test("inventory writes documentation from the Full name tab", async ({ page }) => {
  await openInventory(page);
  const pane = page.getByTestId("inventory-detail-pane");
  await expect(pane).toBeVisible();

  // No docs file yet: the Full name tab offers to create it.
  const viewer = page.getByTestId("inventory-doc-viewer");
  await expect(viewer).toContainText("No documentation yet");
  await page.getByTestId("inventory-doc-edit-button").click();

  // The editor opens empty and takes the focus, so typing starts immediately.
  const { host, lines, input } = docEditor(page);
  await expect(host).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.type("# E2E widget\n\nDoes **things**.");
  await expect(lines).toContainText("# E2E widget");

  // Saving renders the Markdown in the viewer: the heading becomes a heading
  // and the bold markers stop being literal text.
  await page.getByTestId("inventory-doc-save-button").click();
  await expect(host).toBeHidden();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading", { name: "E2E widget" }))
    .toBeVisible();
  await expect(viewer).toContainText("Does things.");
  await expect(page.getByText("**things**")).toBeHidden();

  // Persisted to the VFS: still rendered after a reload. Locators are lazy, so
  // `viewer` survives the reload.
  await page.reload();
  await page.getByText("e2e-docs").first().click();
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading", { name: "E2E widget" }))
    .toBeVisible();

  // Edit reopens prefilled with what was saved — asserted on the rendered
  // lines, which is the only place the content exists in Monaco's DOM.
  await page.getByTestId("inventory-doc-edit-button").click();
  const reopened = docEditor(page);
  await expect(reopened.lines).toContainText("# E2E widget");
  await expect(reopened.lines).toContainText("Does **things**.");

  // Cancel discards without touching the file or the viewer.
  await reopened.host.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("discarded draft");
  await page.getByTestId("inventory-doc-cancel-button").click();
  await expect(reopened.host).toBeHidden();
  await expect(viewer.getByRole("heading", { name: "E2E widget" }))
    .toBeVisible();
  await expect(viewer).toContainText("Does things.");
  await expect(page.getByText("discarded draft")).toBeHidden();
});
