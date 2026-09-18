import { expect, test } from "@playwright/test";

// Smoke: the landing page loads and the new-project flow reaches an editor.
// Project persistence (OPFS/IDB) starts from a fresh browser context, so the
// landing page always offers "New project".
test("landing creates a new project", async ({ page }) => {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept("E2E smoke"));
  await create.click();
  // First-run creation opens the guided tour, which routes onward to
  // the overview — either landing proves the creation flow.
  await expect(page).toHaveURL(/\/projects\/.+\/(editor|overview)/);
});
