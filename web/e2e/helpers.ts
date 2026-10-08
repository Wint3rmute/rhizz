import { expect, type Locator, type Page } from "@playwright/test";

export async function skipTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole("alertdialog");
  if (await tourDialog.isVisible()) {
    await tourDialog.getByRole("button", { name: "skip tour" }).click();
    await expect(tourDialog).toBeHidden();
  }
}

function projectIdFromUrl(page: Page): string {
  const id = new URL(page.url()).pathname.split("/")[2];
  if (!id) throw new Error("project id missing from URL");
  return id;
}

export async function createNewProject(
  page: Page,
  projectName: string,
): Promise<string> {
  await page.goto("/");
  const create = page.getByRole("button", { name: "New project" }).first();
  await expect(create).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept(projectName));
  await create.click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  return projectIdFromUrl(page);
}

export async function createFromExample(
  page: Page,
  exampleName: RegExp | string,
  projectName: string,
): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Learn by example" }).click();
  page.once("dialog", (dialog) => void dialog.accept(projectName));
  await page.getByRole("button", { name: exampleName }).click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  return projectIdFromUrl(page);
}

// The whole tour card must sit inside the viewport on every stop —
// `toBeVisible` alone passes for a card floating half off-screen. Asserts
// full containment (not just intersection) against the live viewport size,
// with a 1px rounding tolerance for sub-pixel placement math.
export async function expectInViewport(target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("tour card has no bounding box");
  const viewport = target.page().viewportSize();
  if (!viewport) throw new Error("page has no viewport size");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}
