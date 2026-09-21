import { expect, type Page } from "@playwright/test";

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

export async function createFromExample(
  page: Page,
  exampleName: RegExp | string,
  projectName: string,
): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from an example" }).click();
  page.once("dialog", (dialog) => void dialog.accept(projectName));
  await page.getByRole("button", { name: exampleName }).click();
  await expect(page).toHaveURL(/\/projects\/.+\/(code|overview)/);
  await skipTourIfPresent(page);
  return projectIdFromUrl(page);
}
