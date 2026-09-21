import { expect, test } from "@playwright/test";

// localStorage key holding the JSON-encoded warning level (see
// WARNING_LEVEL_STORAGE_KEY in WarningLevelState.svelte).
const STORAGE_KEY = "RHIZZ_WARNING_LEVEL";

async function openProject(page, name = "E2E strictness") {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept(name));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  // The tour only opens for the very first project; later tests in this
  // file reuse the same browser context, so dismiss conditionally.
  const tourDialog = page.getByRole("alertdialog");
  if (await tourDialog.isVisible()) {
    await tourDialog.getByRole("button", { name: "skip tour" }).click();
    await expect(tourDialog).toBeHidden();
  }
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  return id;
}

// The desktop navbar select (the mobile-menu copy has a different id and
// is hidden at this viewport width).
function strictnessSelect(page) {
  return page.locator("select#warning-level");
}

test("strictness survives a page reload", async ({ page }) => {
  const id = await openProject(page);
  const select = strictnessSelect(page);
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("component");

  await select.selectOption("business");
  await expect(select).toHaveValue("business");
  await expect
    .poll(async () =>
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    )
    .toBe('"business"');

  await page.goto(`/projects/${id}/overview`);
  await expect(strictnessSelect(page)).toHaveValue("business");

  await page.reload();
  await expect(strictnessSelect(page)).toHaveValue("business");
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).toBe('"business"');
});

test("a corrupt stored strictness falls back to component", async ({ page }) => {
  await page.addInitScript(
    (key) => void localStorage.setItem(key, "{oops"),
    STORAGE_KEY,
  );
  await openProject(page, "E2E strictness corrupt");
  await expect(strictnessSelect(page)).toHaveValue("component");
});
