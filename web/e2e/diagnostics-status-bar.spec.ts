import { expect, test } from "@playwright/test";

// The layout-level diagnostics status bar is visible on every project
// subpage (but never inside chrome-free diagram embeds).
async function openProject(page, name = "E2E status bar") {
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
  return id;
}

test("diagnostics status bar shows on overview, code, and modeling", async ({ page }) => {
  const id = await openProject(page);
  const bar = page.getByTestId("diagnostics-status-bar");

  await page.goto(`/projects/${id}/overview`);
  await expect(bar).toBeVisible();

  await page.goto(`/projects/${id}/code`);
  await expect(bar).toBeVisible();

  await page.goto(`/projects/${id}/modeling`);
  await expect(bar).toBeVisible();
  // The bar expands in place on every page.
  await bar.getByRole("button").click();
  await expect(bar.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
