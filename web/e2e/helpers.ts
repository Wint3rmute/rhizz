import { expect, type Locator, type Page } from "@playwright/test";

export async function skipTourIfPresent(page: Page): Promise<void> {
  const tourDialog = page.getByRole("alertdialog");
  if (await tourDialog.isVisible()) {
    await tourDialog.getByRole("button", { name: "Skip" }).click();
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
//
// Polls rather than sampling once: the tour positions its card after the
// target mounts, so a box read right after the heading appears can still be
// the pre-placement position (y = -720 on the first stop). A card that stays
// off-screen still fails once the poll times out.
export async function expectInViewport(target: Locator): Promise<void> {
  const viewport = target.page().viewportSize();
  if (!viewport) throw new Error("page has no viewport size");
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      if (!box) return null;
      return {
        left: box.x >= -1,
        top: box.y >= -1,
        right: box.x + box.width <= viewport.width + 1,
        bottom: box.y + box.height <= viewport.height + 1,
      };
    })
    .toEqual({ left: true, top: true, right: true, bottom: true });
}
