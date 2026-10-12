import { expect, test } from "@playwright/test";
import { createFromExample } from "./helpers";

// The browser tab mirrors the workspace: "Rhizz: <project> - <page>".
// Asserted through real navigation (not just direct loads) so the title's
// reactivity to route changes is covered too.
test("tab title names the project and page", async ({ page }) => {
  const id = await createFromExample(
    page,
    /Quadcopter Drone/,
    "E2E page title",
  );

  await page.goto(`/projects/${id}/inventory`);
  await expect(page).toHaveTitle("Rhizz: E2E page title - Inventory");

  await page.getByRole("link", { name: "Overview" }).first().click();
  await expect(page).toHaveTitle("Rhizz: E2E page title - Overview");

  await page.getByRole("link", { name: "Modeling" }).first().click();
  await expect(page).toHaveTitle("Rhizz: E2E page title - Modeling");

  await page.getByRole("link", { name: "Code" }).first().click();
  await expect(page).toHaveTitle("Rhizz: E2E page title - Code");

  // Off project pages the tab falls back to the bare app title.
  await page.goto("/projects");
  await expect(page).toHaveTitle("Rhizz");
});
