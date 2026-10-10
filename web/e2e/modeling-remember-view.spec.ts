import { expect, type Page, test } from "@playwright/test";
import { createNewProject } from "./helpers";

// Leaving Modeling for another page and coming back (navbar link or the
// "Go to Modeling" palette row, both of which target the bare page) reopens
// the last settled view instead of always falling back to the first one.

function diagramsTree(page: Page) {
  return page.getByTestId("modeling-pane-left");
}

function card(page: Page, label: string) {
  return page.getByTestId("inventory-card").filter({ hasText: label });
}

test("modeling remembers the last opened view across pages", async ({ page }) => {
  const id = await createNewProject(page, "E2E remember view");
  await page.goto(`/projects/${id}/modeling`);
  await expect(page).toHaveURL(`/projects/${id}/modeling/main.hcl`);

  // A second view to leave open, created through Inventory's "create a view"
  // action — which lands Modeling on its own path.
  const tree = diagramsTree(page);
  await page.getByRole("button", { name: "+ Component" }).click();
  const createModal = page.getByTestId("create-component-modal");
  await expect(createModal).toBeVisible();
  await createModal.locator("#new-comp-name").fill("e2e-second-view");
  await createModal.getByRole("button", { name: "Create Definition" }).click();
  await expect(createModal).toBeHidden();
  await page.goto(`/projects/${id}/inventory/e2e-second-view`);
  await expect(card(page, "e2e-second-view")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("inventory-create-view").click();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );

  // Away to another page and back via the navbar: the open view survives.
  await page.getByRole("link", { name: "Inventory" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/inventory`));
  await page.getByRole("link", { name: "Modeling" }).first().click();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );
  await expect(tree.getByRole("button", { name: "e2e-second-view.hcl" }))
    .toHaveAttribute("aria-current", "true");

  // Same through the command palette's "Go to Modeling" row.
  await page.getByRole("link", { name: "Code" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/code`));
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("option", { name: "Go to Modeling" }).click();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );

  // A reload keeps the shareable URL — memory never overrides an address.
  await page.reload();
  await expect(page).toHaveURL(
    `/projects/${id}/modeling/e2e-second-view.hcl`,
  );
});
